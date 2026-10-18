import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { shell } from 'electron'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { CredentialStore, type ChatgptSession } from './credentials'
import type { ChatgptLoginState } from '../../shared/ai'

const resource = 'https://api.openai.com/v1'
const issuer = 'https://auth.openai.com'
const authorizeEndpoint = `${issuer}/api/accounts/authorize`
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))

type TokenResponse = {
  access_token: string
  refresh_token: string
  id_token: string
  expires_in: number
  scope: string
  token_type: string
}
export function permitsChatgptPlan(session: ChatgptSession | undefined): boolean {
  return session?.scope.split(' ').includes('chatgpt.tokens.use.direct') ?? false
}

async function exchange(
  fields: Record<string, string>,
  signal: AbortSignal
): Promise<TokenResponse> {
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...fields, resource }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)])
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const code = typeof body?.error === 'string' ? body.error : body?.error?.code
    const description = body?.error_description ?? body?.error?.message
    const error = new Error(
      `ChatGPT authorization failed (${response.status}): ${typeof code === 'string' ? code : 'token exchange rejected'}${typeof description === 'string' ? ` — ${description.slice(0, 500)}` : ''}`
    )
    Object.assign(error, { code })
    throw error
  }
  if (
    typeof body?.token_type !== 'string' ||
    body.token_type.toLowerCase() !== 'bearer' ||
    typeof body.access_token !== 'string' ||
    !body.access_token ||
    typeof body.refresh_token !== 'string' ||
    !body.refresh_token ||
    typeof body.id_token !== 'string' ||
    !body.id_token ||
    typeof body.scope !== 'string' ||
    !Number.isFinite(body.expires_in) ||
    body.expires_in <= 0
  ) {
    throw new Error('ChatGPT returned an invalid token response.')
  }
  return body as TokenResponse
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let cancel: () => void = () => {}
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        cancel = () => reject(signal.reason)
        if (signal.aborted) cancel()
        else signal.addEventListener('abort', cancel, { once: true })
      })
    ])
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

export class ChatgptAuth {
  private loginAbort: AbortController | null = null
  private refreshOperation: { token: string; promise: Promise<string> } | null = null
  private loginState: ChatgptLoginState = { phase: 'idle' }
  private listeners = new Set<(state: ChatgptLoginState) => void>()
  constructor(private credentials: CredentialStore) {}

  get state(): ChatgptLoginState {
    return this.loginState
  }
  onState(listener: (state: ChatgptLoginState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private setState(state: ChatgptLoginState): void {
    this.loginState = state
    for (const listener of this.listeners) listener(state)
  }

  cancel(): void {
    this.loginAbort?.abort(new Error('ChatGPT sign-in cancelled.'))
  }

  async connect(onAuthorizationReceived: () => void): Promise<void> {
    if (this.loginAbort) throw new Error('A ChatGPT sign-in is already in progress.')
    const abort = new AbortController()
    this.loginAbort = abort
    const verifier = randomBytes(32).toString('base64url')
    const state = randomBytes(32).toString('base64url')
    const nonce = randomBytes(32).toString('base64url')
    let server: Server | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let cancelCallback: () => void = () => {}
    this.setState({ phase: 'preparing' })
    try {
      // Persist the installation identity before opening the authorization flow.
      await this.credentials.update(() => abort.signal.throwIfAborted())
      const credentials = await this.credentials.load()
      const selectedSession = credentials.session
      abort.signal.throwIfAborted()
      const callback = new Promise<{ code: string; clientId: string }>((resolve, reject) => {
        cancelCallback = () => reject(abort.signal.reason)
        abort.signal.addEventListener('abort', cancelCallback, { once: true })
        timeout = setTimeout(
          () => abort.abort(new Error('ChatGPT sign-in timed out. Please try again.')),
          180_000
        )
        let accepted = false
        server = createServer((request, response) => {
          const url = new URL(request.url ?? '/', 'http://127.0.0.1')
          if (request.method !== 'GET' || url.pathname !== '/auth/callback') {
            response.writeHead(404).end()
            return
          }
          if (accepted) {
            response.writeHead(409).end('Authorization already received. Return to Lepis.')
            return
          }
          if (url.searchParams.get('state') !== state) {
            response.writeHead(400).end('Invalid state.')
            return
          }
          const error = url.searchParams.get('error')
          const code = url.searchParams.get('code')
          const clientId = url.searchParams.get('client_id') || credentials.clientId
          if (
            error ||
            !code ||
            !clientId ||
            clientId === 'dynamic_agent_client' ||
            (credentials.clientId && clientId !== credentials.clientId)
          ) {
            response
              .writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
              .end('Sign-in was not completed. Return to Lepis.')
            reject(
              new Error(
                error === 'access_denied'
                  ? 'ChatGPT access was declined.'
                  : 'Invalid ChatGPT authorization callback.'
              )
            )
            if (error) onAuthorizationReceived()
            return
          }
          accepted = true
          response
            .writeHead(200, {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
              'Referrer-Policy': 'no-referrer'
            })
            .end('Authorization received. Lepis is completing sign-in. You can close this tab.')
          resolve({ code, clientId })
        })
        server.on('error', reject)
      })
      // Install a handler before awaiting the browser; cancellation must never reject unobserved.
      void callback.catch(() => {})
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject)
        server!.listen(0, '127.0.0.1', resolve)
      })
      const address = server!.address()
      if (!address || typeof address === 'string')
        throw new Error('Cannot start the local sign-in callback.')
      const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`
      const url = new URL(authorizeEndpoint)
      url.search = new URLSearchParams({
        client_id: credentials.clientId ?? 'dynamic_agent_client',
        ...(!credentials.clientId ? { agent_name_hint: 'Lepis' } : {}),
        ...(selectedSession
          ? { id_token_hint: selectedSession.idToken, login_hint: selectedSession.email }
          : {}),
        ...(selectedSession && !permitsChatgptPlan(selectedSession) ? { prompt: 'consent' } : {}),
        ext_agent_host_id: credentials.hostId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: scopes,
        resource,
        state,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url')
      }).toString()
      this.setState({ phase: 'waiting-browser' })
      await abortable(shell.openExternal(url.toString()), abort.signal)
      const result = await callback
      abort.signal.throwIfAborted()
      onAuthorizationReceived()
      server!.close()
      this.setState({ phase: 'exchanging-code' })
      await this.credentials.update((value) => {
        abort.signal.throwIfAborted()
        value.clientId = result.clientId
      })
      const tokens = await exchange(
        {
          grant_type: 'authorization_code',
          client_id: result.clientId,
          code: result.code,
          code_verifier: verifier,
          redirect_uri: redirectUri
        },
        abort.signal
      )
      this.setState({ phase: 'verifying-identity' })
      const { payload } = await abortable(
        jwtVerify(tokens.id_token, jwks, {
          issuer,
          audience: result.clientId,
          requiredClaims: ['sub', 'exp', 'iat'],
          clockTolerance: 5
        }),
        abort.signal
      )
      if (payload.nonce !== nonce) throw new Error('ChatGPT identity verification failed.')
      if (selectedSession && payload.sub !== selectedSession.subject)
        throw new Error('The signed-in ChatGPT account does not match the selected account.')
      abort.signal.throwIfAborted()
      this.setState({ phase: 'saving-session' })
      await this.credentials.update((value) => {
        abort.signal.throwIfAborted()
        value.session = {
          clientId: result.clientId,
          subject: payload.sub!,
          email: typeof payload.email === 'string' ? payload.email : 'ChatGPT account',
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          scope: tokens.scope
        }
      })
      this.setState({ phase: 'idle' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ChatGPT sign-in failed.'
      this.setState(
        abort.signal.aborted && message.includes('cancelled')
          ? { phase: 'idle' }
          : { phase: 'error', error: message }
      )
      throw error
    } finally {
      clearTimeout(timeout)
      abort.signal.removeEventListener('abort', cancelCallback)
      server?.close()
      server?.closeAllConnections()
      if (this.loginAbort === abort) this.loginAbort = null
    }
  }

  async token(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const { session } = await this.credentials.load()
    if (!session) throw new Error('Connect your ChatGPT account first.')
    if (!permitsChatgptPlan(session))
      throw new Error('Enable ChatGPT plan usage in AI settings before sending requests.')
    if (session.expiresAt > Date.now() + 30_000) return session.accessToken
    if (this.refreshOperation?.token !== session.refreshToken) {
      const operation = { token: session.refreshToken, promise: this.refresh(session) }
      this.refreshOperation = operation
      void operation.promise
        .finally(() => {
          if (this.refreshOperation === operation) this.refreshOperation = null
        })
        .catch(() => {})
    }
    return signal
      ? abortable(this.refreshOperation!.promise, signal)
      : this.refreshOperation!.promise
  }
  private async refresh(session: ChatgptSession): Promise<string> {
    try {
      const tokens = await exchange(
        {
          grant_type: 'refresh_token',
          client_id: session.clientId,
          refresh_token: session.refreshToken
        },
        AbortSignal.timeout(30_000)
      )
      const { payload } = await jwtVerify(tokens.id_token, jwks, {
        issuer,
        audience: session.clientId,
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: 5
      })
      if (payload.sub !== session.subject)
        throw new Error('The refreshed ChatGPT account does not match.')
      await this.credentials.update((value) => {
        if (value.session?.refreshToken !== session.refreshToken)
          throw new Error('ChatGPT connection changed during refresh.')
        value.session = {
          ...session,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          scope: tokens.scope
        }
      })
      if (!tokens.scope.split(' ').includes('chatgpt.tokens.use.direct'))
        throw new Error(
          'ChatGPT plan usage permission is no longer enabled. Reconnect in AI settings.'
        )
      return tokens.access_token
    } catch (error) {
      if (
        [
          'invalid_grant',
          'invalid_refresh_token',
          'token_expired',
          'refresh_token_expired',
          'refresh_token_invalidated',
          'refresh_token_reused'
        ].includes(String((error as { code?: string }).code))
      ) {
        await this.credentials.update((value) => {
          if (value.session?.refreshToken === session.refreshToken) delete value.session
        })
      }
      throw error
    }
  }
  async disconnect(): Promise<void> {
    this.cancel()
    const credentials = await this.credentials.load()
    const session = credentials.session
    await this.credentials.update((value) => {
      delete value.session
    })
    if (!session) return
    try {
      const discovery = await fetch(`${issuer}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(10_000)
      })
      if (!discovery.ok) throw new Error('Discovery unavailable')
      const { revocation_endpoint: endpoint } = await discovery.json()
      if (typeof endpoint !== 'string' || new URL(endpoint).origin !== issuer)
        throw new Error('Invalid revocation endpoint')
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: session.refreshToken,
          token_type_hint: 'refresh_token',
          client_id: session.clientId
        }),
        signal: AbortSignal.timeout(10_000)
      })
      if (!response.ok) throw new Error('Revocation failed')
    } catch {
      throw new Error(
        'Disconnected locally. Remote revocation could not be confirmed; remove Lepis from ChatGPT connected apps to revoke access.'
      )
    }
  }
}
