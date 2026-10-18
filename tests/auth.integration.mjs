import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { aiModules } from './fixtures/ai-modules.mjs'

const { app, shell } = electron
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-auth-'))
app.setPath('userData', directory)
const modules = aiModules()
const { ChatgptAuth } = modules.load('chatgpt-auth')
const originalFetch = globalThis.fetch
const originalOpen = shell.openExternal
const permission = 'openid offline_access resource.invoke chatgpt.tokens.use.direct'
let failures = 0

app
  .whenReady()
  .then(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const jwk = { ...(await exportJWK(publicKey)), kid: 'audit', alg: 'RS256', use: 'sig' }
    async function scenario(name, test) {
      let value = { hostId: `urn:uuid:${crypto.randomUUID()}`, keys: {} }
      let authorization
      let tokenRequest
      let writes = []
      let rejectWrite = false
      const store = {
        load: async () => value,
        update: async (change) => {
          const next = structuredClone(value)
          change(next)
          if (rejectWrite) throw new Error('Fixture disk failure')
          value = next
          writes.push(structuredClone(value))
        }
      }
      const auth = new ChatgptAuth(store)
      const tokens = async (overrides = {}, claims = {}) => ({
        token_type: 'Bearer',
        access_token: 'fixture-access',
        refresh_token: 'fixture-refresh',
        id_token: await new SignJWT({
          nonce: authorization.searchParams.get('nonce'),
          email: 'test@example.invalid',
          ...claims
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'audit' })
          .setIssuer('https://auth.openai.com')
          .setAudience('issued-audit-client')
          .setSubject(claims.sub ?? 'fixture-user')
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(privateKey),
        expires_in: 3600,
        scope: permission,
        ...overrides
      })
      globalThis.fetch = async (url, options) => {
        const target = String(url)
        if (target.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] })
        if (target.endsWith('/oauth/token')) return tokenRequest(options)
        if (target.endsWith('/.well-known/openid-configuration'))
          return Response.json({
            revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke'
          })
        if (target.endsWith('/oauth/revoke')) return new Response(null, { status: 200 })
        if (target.startsWith('http://127.0.0.1:')) return originalFetch(url, options)
        throw new Error('Unexpected endpoint')
      }
      const callback = async (fields = {}) => {
        const url = new URL(authorization.searchParams.get('redirect_uri'))
        url.search = new URLSearchParams({
          code: 'fixture-code',
          state: authorization.searchParams.get('state'),
          client_id: 'issued-audit-client',
          ...fields
        })
        return originalFetch(url)
      }
      shell.openExternal = async (url) => {
        authorization = new URL(url)
        await callback()
      }
      tokenRequest = async () => Response.json(await tokens())
      try {
        await test({
          auth,
          store,
          callback,
          tokens,
          get value() {
            return value
          },
          set value(next) {
            value = next
          },
          get authorization() {
            return authorization
          },
          get writes() {
            return writes
          },
          set rejectWrite(next) {
            rejectWrite = next
          },
          set tokenRequest(next) {
            tokenRequest = next
          }
        })
        console.log(`PASS: ${name}`)
      } catch (error) {
        failures++
        console.error(`FAIL: ${name}: ${error.message}`)
      } finally {
        auth.cancel()
      }
    }

    await scenario('issued client registration survives a failed code exchange', async (s) => {
      s.tokenRequest = async () => Response.json({ error: 'invalid_grant' }, { status: 400 })
      await assert.rejects(
        s.auth.connect(() => {}),
        /invalid_grant/
      )
      assert.equal(s.value.clientId, 'issued-audit-client')
      assert.equal(s.value.session, undefined)
    })
    await scenario('cancellation aborts the token exchange immediately', async (s) => {
      let finish
      s.tokenRequest = (options) =>
        new Promise((resolve, reject) => {
          finish = resolve
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true
          })
          setImmediate(() => s.auth.cancel())
        })
      const attempt = s.auth.connect(() => {})
      const result = await Promise.race([
        attempt.then(
          () => 'connected',
          () => 'cancelled'
        ),
        new Promise((resolve) => setTimeout(() => resolve('still waiting'), 250))
      ])
      finish(Response.json(await s.tokens()))
      await attempt.catch(() => {})
      assert.equal(result, 'cancelled')
      assert.equal(s.value.session, undefined)
    })
    await scenario(
      'a returning account cannot be silently replaced by another identity',
      async (s) => {
        await s.auth.connect(() => {})
        s.tokenRequest = async () => Response.json(await s.tokens({}, { sub: 'different-user' }))
        await assert.rejects(
          s.auth.connect(() => {}),
          /account|identity/i
        )
        assert.equal(s.value.session.subject, 'fixture-user')
      }
    )
    await scenario(
      'returning sign-in uses saved identity hints and issued registration',
      async (s) => {
        await s.auth.connect(() => {})
        const idToken = s.value.session.idToken
        await s.auth.connect(() => {})
        assert.equal(s.authorization.searchParams.get('client_id'), 'issued-audit-client')
        assert.equal(s.authorization.searchParams.get('agent_name_hint'), null)
        assert.ok(
          s.authorization.searchParams.get('id_token_hint') === idToken,
          'returning sign-in must include the saved identity hint'
        )
      }
    )
    await scenario(
      'identity-only sign-in is retained but cannot authorize inference',
      async (s) => {
        s.tokenRequest = async () =>
          Response.json(await s.tokens({ scope: 'openid profile email offline_access' }))
        await s.auth.connect(() => {})
        assert.equal(s.value.session.subject, 'fixture-user')
        await assert.rejects(s.auth.token(), /permission|plan/i)
      }
    )
    await scenario(
      'failed credential persistence does not expose an unsaved connection',
      async (s) => {
        s.tokenRequest = async () => {
          s.rejectWrite = true
          return Response.json(await s.tokens())
        }
        await assert.rejects(
          s.auth.connect(() => {}),
          /disk failure/
        )
        assert.equal(s.value.session, undefined)
      }
    )
    await scenario('a failed old refresh cannot erase a newly connected session', async (s) => {
      await s.auth.connect(() => {})
      s.value.session.expiresAt = 0
      let finish
      s.tokenRequest = () =>
        new Promise((resolve) => {
          finish = resolve
        })
      const refresh = s.auth.token()
      while (!finish) await new Promise((resolve) => setImmediate(resolve))
      s.value = {
        ...s.value,
        session: {
          ...s.value.session,
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          expiresAt: Date.now() + 3600000
        }
      }
      finish(Response.json({ error: 'invalid_grant' }, { status: 400 }))
      await assert.rejects(refresh, /invalid_grant/)
      assert.equal(s.value.session?.accessToken, 'new-access')
    })
    await scenario('OAuth error objects produce usable diagnostics', async (s) => {
      s.tokenRequest = async () =>
        Response.json(
          { error: { code: 'invalid_grant', message: 'Authorization code expired.' } },
          { status: 400 }
        )
      await assert.rejects(
        s.auth.connect(() => {}),
        /invalid_grant.*Authorization code expired/
      )
    })
    await scenario('a valid identity with a wrong nonce is rejected', async (s) => {
      s.tokenRequest = async () => Response.json(await s.tokens({}, { nonce: 'wrong' }))
      await assert.rejects(
        s.auth.connect(() => {}),
        /verification/
      )
      assert.equal(s.value.session, undefined)
    })
    await scenario('an altered signature cannot establish a session', async (s) => {
      s.tokenRequest = async () => {
        const body = await s.tokens()
        body.id_token = body.id_token.slice(0, -10) + 'AAAAAAAAAA'
        return Response.json(body)
      }
      await assert.rejects(
        s.auth.connect(() => {}),
        /signature/
      )
      assert.equal(s.value.session, undefined)
    })
    await scenario(
      'declined consent does not exchange a code and returns to the app',
      async (s) => {
        let exchanged = false
        let returned = false
        s.tokenRequest = async () => {
          exchanged = true
          return Response.json(await s.tokens())
        }
        shell.openExternal = async (url) => {
          const authorization = new URL(url)
          const callback = new URL(authorization.searchParams.get('redirect_uri'))
          callback.search = new URLSearchParams({
            error: 'access_denied',
            state: authorization.searchParams.get('state')
          })
          assert.equal((await originalFetch(callback)).status, 400)
        }
        await assert.rejects(
          s.auth.connect(() => {
            returned = true
          }),
          /declined/
        )
        assert.equal(exchanged, false)
        assert.equal(returned, true)
        assert.equal(s.value.session, undefined)
      }
    )
    await scenario('temporary refresh failures preserve the current session', async (s) => {
      await s.auth.connect(() => {})
      s.value.session.expiresAt = 0
      s.tokenRequest = async () => Response.json({ error: 'server_error' }, { status: 503 })
      await assert.rejects(s.auth.token(), /server_error/)
      assert.equal(s.value.session.subject, 'fixture-user')
    })
    await scenario('login progress exposes every phase in order and settles', async (s) => {
      const phases = []
      const unsubscribe = s.auth.onState((state) => phases.push(state.phase))
      await s.auth.connect(() => {})
      unsubscribe()
      assert.deepEqual(phases, [
        'preparing',
        'waiting-browser',
        'exchanging-code',
        'verifying-identity',
        'saving-session',
        'idle'
      ])
      assert.equal(s.auth.state.phase, 'idle')
    })
    await scenario(
      'stopping inference does not wait for or corrupt a shared refresh',
      async (s) => {
        await s.auth.connect(() => {})
        s.value.session.expiresAt = 0
        let finishRefresh
        s.tokenRequest = () =>
          new Promise((resolve) => {
            finishRefresh = resolve
          })
        const controller = new AbortController()
        const pending = s.auth.token(controller.signal)
        const rejected = assert.rejects(pending, /stopped/)
        while (!finishRefresh) await new Promise((resolve) => setImmediate(resolve))
        controller.abort(new Error('stopped'))
        await rejected
        const shared = s.auth.token()
        finishRefresh(Response.json(await s.tokens({ access_token: 'refreshed-fixture' })))
        assert.ok((await shared) === 'refreshed-fixture')
        assert.ok(s.value.session.accessToken === 'refreshed-fixture')
      }
    )
  })
  .then(() => finish(failures ? 1 : 0))
  .catch((error) => {
    console.error(error)
    finish(1)
  })

function finish(code) {
  globalThis.fetch = originalFetch
  shell.openExternal = originalOpen
  modules.dispose()
  fs.rmSync(directory, { recursive: true, force: true })
  app.exit(code)
}
