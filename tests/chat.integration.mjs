import { showTextOptions } from './fixtures/annotation-toolbar.mjs'
import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { aiModules } from './fixtures/ai-modules.mjs'
import { createPdf } from './fixtures/pdf.mjs'
import { enableTestFocus } from './fixtures/focus.mjs'

const { app, BrowserWindow, ipcMain, shell } = electron
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-chat-'))
app.setPath('userData', temp)
const modules = aiModules()
const { AiService } = modules.load('service')
const { ChatgptAuth } = modules.load('chatgpt-auth')
let win
let service
let generated = []
let indexed = []
let currentDocument
let cancelAnswer = false
let sessionWrites = []
const mtimes = new Map()
const evaluate = async (code) => {
  try {
    return await win.webContents.executeJavaScript(code)
  } catch (error) {
    throw new Error(`Renderer evaluation failed: ${code}`, { cause: error })
  }
}
async function waitFor(code, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (!(await evaluate(code))) {
    if (Date.now() > deadline)
      throw new Error(`Timed out: ${code}\n${await evaluate('document.body.innerText')}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
const click = (label) =>
  evaluate(
    `(() => {
      const element = Array.from(document.querySelectorAll('[aria-label="${label}"]')).find(element => element.getBoundingClientRect().width > 0);
      if (element.getAttribute('aria-haspopup') === 'menu') {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      } else element.click();
    })()`
  )
const setInput = (label, text) =>
  evaluate(`(() => {
  const input = Array.from(document.querySelectorAll('[aria-label="${label}"]')).find(element => element.getBoundingClientRect().width > 0);
  Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});
  input.dispatchEvent(new Event('input',{bubbles:true}));
})()`)

const dragChatFiles = (type, target = 'textarea') =>
  evaluate(`(() => {
    const zone = document.querySelector('aside:not(.hidden) [data-chat-composer]');
    const target = ${JSON.stringify(target)} === 'zone' ? zone : zone.querySelector(${JSON.stringify(target)});
    const transfer = new DataTransfer();
    for (const file of window.chatAttachmentFiles) transfer.items.add(file);
    target.dispatchEvent(new DragEvent(${JSON.stringify(type)}, {bubbles:true, cancelable:true, dataTransfer:transfer}));
  })()`)

function pdf(text) {
  const stream = `BT /F1 20 Tf 72 700 Td (${text}) Tj 0 -50 Td (A second passage about plant cells.) Tj ET`
  return createPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ])
}
const files = new Map([
  ['first.pdf', pdf('Photosynthesis converts light into energy.')],
  ['second.pdf', pdf('Chlorophyll absorbs sunlight.')]
])

async function testAuthentication() {
  const { SignJWT, exportJWK, generateKeyPair } = await import('jose')
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey)
  let authorization
  let exchanged = 0
  let returnedToApp = 0
  const credentials = { hostId: `urn:uuid:${crypto.randomUUID()}`, keys: {} }
  const store = { load: async () => credentials, update: async (change) => change(credentials) }
  const auth = new ChatgptAuth(store)
  const originalFetch = globalThis.fetch
  const originalOpen = shell.openExternal
  globalThis.fetch = async (url, options) => {
    const target = String(url)
    if (target.includes('/.well-known/jwks.json'))
      return Response.json({ keys: [{ ...jwk, kid: 'test', alg: 'RS256', use: 'sig' }] })
    if (target.endsWith('/oauth/token')) {
      const fields = new URLSearchParams(options.body)
      assert.equal(fields.get('client_id'), 'issued-test-client')
      assert.equal(fields.get('resource'), 'https://api.openai.com/v1')
      if (fields.get('grant_type') === 'authorization_code') {
        const hash = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(fields.get('code_verifier'))
        )
        assert.equal(
          Buffer.from(hash).toString('base64url'),
          authorization.searchParams.get('code_challenge')
        )
        assert.equal(fields.get('redirect_uri'), authorization.searchParams.get('redirect_uri'))
      } else assert.equal(fields.get('grant_type'), 'refresh_token')
      exchanged++
      const idToken = await new SignJWT({
        nonce: authorization.searchParams.get('nonce'),
        email: 'test@example.invalid'
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer('https://auth.openai.com')
        .setAudience('issued-test-client')
        .setSubject('test-user')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey)
      return Response.json({
        token_type: 'Bearer',
        access_token: `test-access-${exchanged}`,
        refresh_token: `test-refresh-${exchanged}`,
        id_token: idToken,
        expires_in: 3600,
        scope: 'openid offline_access resource.invoke chatgpt.tokens.use.direct'
      })
    }
    if (target.startsWith('http://127.0.0.1:')) return originalFetch(url, options)
    throw new Error(`Unexpected network request: ${target}`)
  }
  shell.openExternal = async (url) => {
    authorization = new URL(url)
    assert.equal(authorization.origin, 'https://auth.openai.com')
    assert.equal(authorization.pathname, '/api/accounts/authorize')
    assert.equal(authorization.searchParams.get('client_id'), 'dynamic_agent_client')
    assert.equal(authorization.searchParams.get('ext_agent_host_id'), credentials.hostId)
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
    const callback = new URL(authorization.searchParams.get('redirect_uri'))
    callback.search = new URLSearchParams({
      code: 'test-code',
      state: 'wrong-state',
      client_id: 'issued-test-client'
    })
    assert.equal((await originalFetch(callback)).status, 400)
    assert.equal(returnedToApp, 0, 'an invalid callback must not activate Lepis')
    callback.searchParams.set('state', authorization.searchParams.get('state'))
    assert.equal((await originalFetch(callback)).status, 200)
  }
  try {
    await auth.connect(() => {
      returnedToApp++
      assert.equal(exchanged, 0, 'return to Lepis before waiting for the token exchange')
    })
    assert.equal(returnedToApp, 1, 'an accepted authorization must return the user to Lepis')
    assert.equal(credentials.session.subject, 'test-user')
    assert.equal(credentials.clientId, 'issued-test-client')
    assert.equal(await auth.token(), 'test-access-1')
    credentials.session.expiresAt = 0
    const refreshed = await Promise.all([auth.token(), auth.token()])
    assert.deepEqual(refreshed, ['test-access-2', 'test-access-2'])
    assert.equal(exchanged, 2)
    shell.openExternal = async () => {
      setImmediate(() => auth.cancel())
    }
    await assert.rejects(
      auth.connect(() => assert.fail('cancelled sign-in must not activate Lepis')),
      /cancelled/
    )
    console.log(
      'PASS: ChatGPT PKCE/state, issued client ID, signed identity, serialized refresh and login cancellation (offline)'
    )
  } finally {
    auth.cancel()
    globalThis.fetch = originalFetch
    shell.openExternal = originalOpen
  }
}

app
  .whenReady()
  .then(async () => {
    await testAuthentication()
    service = new AiService(temp)
    service.settings({ consent: false })
    const credentials = {
      hostId: 'test',
      keys: { openai: 'fixture-openai-key', anthropic: 'fixture-anthropic-key' },
      session: { email: 'test@example.invalid', scope: 'chatgpt.tokens.use.direct' }
    }
    service.credentials.load = async () => credentials
    service.credentials.update = async (change) => change(credentials)
    let catalogUnavailable = true
    service.providers.models = async (provider) => {
      if (provider === 'anthropic') throw new Error('Fixture Anthropic catalog unavailable')
      if (provider === 'openai') return [{ id: 'test-model', name: 'OpenAI test model' }]
      if (catalogUnavailable) throw new Error('Fixture catalog temporarily unavailable')
      return [{ id: 'test-model', name: 'Test model', reasoningLevels: ['low', 'medium', 'high'] }]
    }
    service.providers.generate = async (request) => {
      generated.push(request)
      if (request.instructions.startsWith('Write ONLY'))
        return JSON.stringify({ scope: 'passages', queries: ['photosynthesis', 'chlorophyll'] })
      const sources = service.store.sources(currentDocument.version)
      const answer = `The document discusses plant energy [[${sources[0].id}]].\n\nThe formula is $E=mc^2$, also \\(x_i^2\\).\n\n\\[\n\\frac{a}{b}\n\\]`
      request.onReasoning?.('Checking the passages about plant energy. ')
      await new Promise((resolve) => setTimeout(resolve, 150))
      request.onReasoning?.('The selected evidence supports the explanation.')
      request.onText(answer.slice(0, 30))
      if (cancelAnswer)
        await new Promise((resolve, reject) =>
          request.signal.addEventListener('abort', () => reject(new Error('stopped')), {
            once: true
          })
        )
      await new Promise((resolve) => setTimeout(resolve, 120))
      request.signal.throwIfAborted()
      request.onText(answer.slice(30))
      return answer
    }
    const ai = (name, handler) =>
      ipcMain.handle(`ai:${name}`, (_event, ...args) => handler(...args))
    ai('status', () => service.status())
    ai('settings', (value) => service.settings(value))
    ai('models', (value) => service.providers.models(value))
    ai('open-document', (key, file) => {
      const document = service.openDocument(key, file)
      if (document) currentDocument = document
      return document
    })
    ai('index', (value) => {
      currentDocument = value
      indexed.push(value)
      service.index(value)
    })
    ai('conversations', (value) => service.store.list(value))
    ai('conversation', (id) => service.store.get(id))
    ai('fork', (id, messageId) => service.fork(id, messageId))
    ai('rename', (id, title) => service.store.rename(id, title))
    ai('delete', (id) => service.remove(id))
    ai('send', (request) =>
      service.send(request, (event) => win.webContents.send('ai:event', event))
    )
    ai('stop', (id) => service.stop(id))
    ipcMain.handle('draft:load', () => [])
    ipcMain.handle('draft:save', () => {})
    ipcMain.handle('draft:delete', () => {})
    ipcMain.on('theme:set', () => {})
    ipcMain.handle('session:load', () => ({
      tabs: [...files.keys()].map((filePath) => ({
        path: filePath,
        page: 1,
        scale: 'page-fit',
        scrollTop: 0
      })),
      activePath: 'first.pdf',
      highlightColor: '#FDE047',
      theme: 'light'
    }))
    ipcMain.handle('session:save', (_, value) => {
      sessionWrites.push(value)
    })
    ipcMain.handle('pdf:read', (_, filePath) => ({
      path: filePath,
      name: filePath,
      directoryPath: 'test',
      mtimeMs: mtimes.get(filePath) ?? 1,
      size: files.get(filePath).length,
      source: { kind: 'memory', data: files.get(filePath).slice().buffer }
    }))
    ipcMain.handle('pdf:stat', (_, filePath) => ({
      mtimeMs: mtimes.get(filePath) ?? 1,
      size: files.get(filePath).length
    }))
    ipcMain.handle('pdf:close', () => {})
    ipcMain.handle('pdf:save', (_, request) => {
      files.set(request.filePath, request.data)
      return { mtimeMs: 1, size: request.data.length }
    })
    ipcMain.handle('pdf:release-source', () => {})
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 850,
      webPreferences: {
        preload: path.join(root, 'out/preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false
      }
    })
    const rendererErrors = []
    win.webContents.on('console-message', (details) => {
      if (details.level === 'error') rendererErrors.push(details.message)
    })
    await win.loadFile(path.join(root, 'out/renderer/index.html'))
    await enableTestFocus(win)
    await waitFor(
      `document.querySelector('.visible .textLayer')?.textContent.includes('Photosynthesis')`
    )
    assert.equal(indexed.length, 0, 'opening a PDF does not index it')
    await click('Toggle AI chat')
    await waitFor(
      `document.querySelector('[aria-label="AI chat panel"]') && document.querySelector('[role="dialog"] [aria-label="Allow AI requests"]')`
    )
    await waitFor(
      `!document.body.innerText.includes('Preparing PDF locally') && document.querySelector('[aria-label="Message AI"]')`
    )
    await waitFor(
      `document.querySelector('aside:not(.hidden) [aria-label="New chat"]')?.disabled === false`
    )
    assert.equal(generated.length, 0, 'opening chat does not call the model')
    assert.equal(await evaluate(`document.querySelector('[aria-label="Close AI chat"]')`), null)
    assert.equal(
      await evaluate(`(() => {
      const theme = document.querySelector('[aria-label^="Change theme:"]');
      const toggle = document.querySelector('[aria-label="Toggle AI chat"]');
      return theme.nextElementSibling === toggle && toggle.getAttribute('aria-expanded') === 'true';
    })()`),
      true,
      'chat toggle follows theme and reflects panel visibility'
    )
    await click('Allow AI requests')
    await waitFor(`document.body.innerText.includes('Retry loading models')`)
    catalogUnavailable = false
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Retry loading models')).click()`
    )
    await waitFor(`document.querySelector('[aria-label="AI model"]').textContent === 'Test model'`)
    assert.equal(
      await evaluate(`document.body.innerText.includes('Fixture catalog temporarily unavailable')`),
      false
    )
    await waitFor(`document.querySelector('[aria-label="AI settings"]') !== null`)
    await evaluate(`document.getElementById('chat-font-size').click()`)
    await waitFor(`document.querySelector('[role="option"][data-state="checked"]')`)
    await evaluate(
      `Array.from(document.querySelectorAll('[role="option"]')).find(option => option.textContent === '20 px').click()`
    )
    await waitFor(
      `getComputedStyle(document.querySelector('[aria-label="Message AI"]')).fontSize === '20px'`
    )
    assert.equal(service.store.settings().chatFontSize, 20)
    assert.equal(
      await evaluate(`document.querySelectorAll('[role="dialog"] [role="tab"]').length`),
      4,
      'OpenAI and ChatGPT share one provider section'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[role="dialog"]').textContent.includes('Personal ChatGPT conversations')`
      ),
      false
    )
    await evaluate(
      `Array.from(document.querySelectorAll('[role="dialog"] [role="tab"]')).find(tab => tab.textContent.startsWith('Gemini')).click()`
    )
    await waitFor(`document.querySelector('[aria-label="Gemini API key"]')`)
    await setInput('Gemini API key', 'fixture-unsaved-key')
    await evaluate(
      `Array.from(document.querySelectorAll('[role="dialog"] [role="tab"]')).find(tab => tab.textContent.startsWith('OpenAI')).click()`
    )
    await waitFor(`document.querySelector('[aria-label="OpenAI API key"]')?.value === ''`)
    assert.equal(
      await evaluate(
        `Boolean(document.querySelector('[aria-label="ChatGPT connection"]') && document.querySelector('[aria-label="OpenAI connection"]'))`
      ),
      true
    )
    assert.equal(
      await evaluate(
        `document.querySelectorAll('[role="dialog"] [role="tab"] [data-provider-logo]').length`
      ),
      4
    )
    assert.equal(
      await evaluate(
        `Array.from(document.querySelectorAll('[role="dialog"] button')).find(button => button.textContent === 'Disconnect')?.getAttribute('data-variant')`
      ),
      'destructive'
    )
    win.webContents.send('ai:login-state', { phase: 'exchanging-code' })
    await waitFor(`document.body.innerText.includes('Completing authorization')`)
    await evaluate(`document.querySelector('[role="dialog"] [data-slot="dialog-close"]').click()`)
    win.webContents.send('ai:login-state', { phase: 'verifying-identity' })
    await click('AI settings')
    await waitFor(`document.body.innerText.includes('Verifying your account')`)
    win.webContents.send('ai:login-state', { phase: 'idle' })
    await waitFor(
      `document.querySelector('[role="dialog"] [role="tablist"] [aria-selected="true"]')?.textContent.includes('Connected')`
    )
    await evaluate(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
    )
    await waitFor(`getComputedStyle(document.querySelector('[role="dialog"]')).opacity === '1'`)
    fs.writeFileSync('/tmp/lepis-ai-settings.png', (await win.webContents.capturePage()).toPNG())
    await evaluate(`document.querySelector('[role="dialog"] [data-slot="dialog-close"]').click()`)
    await waitFor(`!document.querySelector('[role="dialog"]')`)
    await waitFor(`document.querySelector('[aria-label="AI model"]').textContent === 'Test model'`)
    assert.equal(
      await evaluate(
        `Boolean(document.querySelector('[aria-label="AI model"]').closest('[data-slot="input-group"]'))`
      ),
      true,
      'model selector is inside the composer'
    )
    await click('AI model')
    await waitFor(
      `document.querySelectorAll('[data-slot="dropdown-menu-sub-trigger"]').length === 2`
    )
    assert.equal(
      await evaluate(
        `Array.from(document.querySelectorAll('[data-slot="dropdown-menu-sub-trigger"]')).map(item => item.textContent).join('|')`
      ),
      'Model|Effort'
    )
    await click('Select effort')
    await waitFor(
      `document.querySelector('[aria-label="Thinking time"] [aria-checked="true"]')?.textContent === 'Medium'`
    )
    await waitFor(`(() => {
      const trigger = document.querySelector('[aria-label="Select effort"]').getBoundingClientRect();
      const submenu = document.querySelector('[data-slot="dropdown-menu-sub-content"]').getBoundingClientRect();
      return Math.abs(submenu.bottom - trigger.bottom) < 2 && submenu.top >= 0;
    })()`)
    await evaluate(
      `Array.from(document.querySelectorAll('[aria-label="Thinking time"] [role="menuitemradio"]')).find(option => option.textContent === 'High').click()`
    )
    await waitFor(
      `document.querySelector('[aria-label="AI model"]').getAttribute('aria-expanded') === 'false'`
    )
    assert.equal(service.store.settings().reasoning['chatgpt:test-model'], 'high')
    await waitFor(
      `!document.querySelector('[role="menu"]') && document.body.style.pointerEvents !== 'none'`
    )
    assert.equal(await evaluate(`document.body.innerText.includes('PDF + model knowledge')`), false)
    const newChatButton = await evaluate(
      `(() => { const rect = document.querySelector('aside:not(.hidden) [aria-label="New chat"]').getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`
    )
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...newChatButton
    })
    await waitFor(`document.querySelector('[role="tooltip"]')?.textContent === 'New chat (⌘⇧O)'`)
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 1,
      y: 1
    })

    assert.equal(
      await evaluate(`(() => {
      const model = document.querySelector('[aria-label="AI model"]');
      const title = document.querySelector('[aria-label="Rename conversation"]');
      return model.getBoundingClientRect().width >= 96
        && model.getBoundingClientRect().width < model.parentElement.getBoundingClientRect().width - 64
        && title.getBoundingClientRect().width >= 144
        && title.getBoundingClientRect().width < title.parentElement.getBoundingClientRect().width - 100;
    })()`),
      true,
      'model and title use compact widths with a minimum'
    )
    assert.equal(
      await evaluate(`getComputedStyle(document.querySelector('.chat-resizer'), '::after').width`),
      '1px'
    )
    await click('AI model')
    await click('Select model')
    await waitFor(
      `document.querySelector('[aria-label="Models"] [role="menuitemradio"]')?.textContent.includes('Test model')`
    )
    await evaluate(`document.querySelector('[aria-label="Models"] [role="menuitemradio"]').click()`)
    await waitFor(
      `document.querySelector('[aria-label="AI model"]').getAttribute('aria-expanded') === 'false'`
    )
    await click('AI model')
    await click('Select model')
    await waitFor(
      `document.querySelectorAll('[aria-label="Models"] [role="menuitemradio"]').length === 2`
    )
    assert.equal(
      await evaluate(
        `Array.from(document.querySelectorAll('[aria-label="Models"] [data-slot="dropdown-menu-label"]')).map(label => label.textContent).join('|')`
      ),
      'OpenAI'
    )
    assert.equal(await evaluate(`document.querySelector('[aria-label="AI provider"]')`), null)
    assert.equal(
      await evaluate(
        `document.querySelectorAll('[aria-label="Models"] [role="menuitemradio"] [data-provider-logo]').length`
      ),
      2
    )
    assert.equal(
      await evaluate(
        `document.querySelectorAll('[aria-label="AI model"] [data-provider-logo]').length`
      ),
      1
    )
    assert.equal(
      await evaluate(
        `document.querySelectorAll('[aria-label="Models"] [data-slot="dropdown-menu-label"] [data-provider-logo]').length`
      ),
      0
    )
    await evaluate(
      `Array.from(document.querySelectorAll('[aria-label="Models"] [role="menuitemradio"]')).find(option => option.textContent === 'OpenAI test model').click()`
    )
    await waitFor(
      `document.querySelector('[aria-label="AI model"]').textContent === 'OpenAI test model'`
    )
    assert.equal(
      service.store.settings().provider,
      'openai',
      'model selection persists the corresponding provider'
    )
    await click('AI model')
    await click('Select model')
    await waitFor(
      `document.querySelectorAll('[aria-label="Models"] [role="menuitemradio"]').length === 2`
    )
    await evaluate(
      `Array.from(document.querySelectorAll('[aria-label="Models"] [role="menuitemradio"]')).find(option => option.textContent === 'Test model').click()`
    )
    await waitFor(`document.querySelector('[aria-label="AI model"]').textContent === 'Test model'`)
    await waitFor(`!document.querySelector('[aria-label="Models"] [role="menuitemradio"]')`)
    assert.equal(service.store.settings().provider, 'chatgpt')
    await click('AI model')
    await click('Select effort')
    await waitFor(
      `document.querySelector('[aria-label="Thinking time"] [aria-checked="true"]')?.textContent === 'High'`
    )
    await click('AI model')
    await waitFor(`!document.querySelector('[role="menu"]')`)

    console.log(
      'PASS: modal settings, grouped connected providers, duplicate model IDs and partial catalog failure'
    )
    assert.ok(indexed[0].sources[0].text.includes('Photosynthesis'))
    console.log('PASS: model catalog failures recover and login progress survives closing settings')
    await waitFor(
      `document.querySelector('[aria-label="Chat empty state"] h2')?.textContent.includes('What would you like to know')`
    )
    fs.writeFileSync('/tmp/lepis-chat-empty.png', (await win.webContents.capturePage()).toPNG())
    for (const [label, expected] of [
      ['Summarize', 'Summarize the entire document'],
      ['Explain key concepts', 'Explain the key concepts'],
      ['Find information', 'Find information about ']
    ]) {
      await evaluate(
        `Array.from(document.querySelectorAll('[aria-label="Chat empty state"] button')).find(button => button.textContent === ${JSON.stringify(label)}).click()`
      )
      await waitFor(
        `document.querySelector('[aria-label="Message AI"]').value.startsWith(${JSON.stringify(expected)})`
      )
      assert.equal(
        await evaluate(`document.activeElement?.getAttribute('aria-label')`),
        'Message AI'
      )
      assert.equal(generated.length, 0, 'suggestions prepare a draft without sending')
      assert.equal(service.store.list('first.pdf').length, 0, 'suggestions do not create history')
      if (label === 'Summarize') {
        assert.equal(
          await evaluate(
            `document.querySelector('[aria-label="Cancel document summary"]').getAttribute('data-slot')`
          ),
          null,
          'summary cancel has no tooltip trigger'
        )
      }
    }
    await click('Toggle AI chat')
    await click('Toggle AI chat')
    await waitFor(`document.activeElement?.getAttribute('aria-label') === 'Message AI'`)
    for (let index = 0; index < 3; index++) {
      await click('New chat')
      await evaluate(`new Promise(resolve => requestAnimationFrame(resolve))`)
      assert.equal(
        await evaluate(`document.activeElement?.getAttribute('aria-label')`),
        'Message AI',
        'new chat focuses the composer'
      )
      assert.equal(
        service.store.list('first.pdf').length,
        0,
        'New chat must not persist an empty conversation'
      )
    }
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="Rename conversation"]').disabled`),
      true,
      'placeholder title cannot be edited'
    )
    const originalVersion = indexed[0].version
    await setInput('Message AI', 'Explain photosynthesis')
    await waitFor(`!document.querySelector('[aria-label="Send message"]').disabled`)
    await evaluate(`(() => {
      const form = document.querySelector('[aria-label="Message AI"]').closest('form');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    })()`)
    await waitFor(
      `document.querySelector('[aria-label="Model reasoning"]')?.getAttribute('aria-busy') === 'true'`
    )
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="Response activity"]')`),
      null,
      'work is not collapsible while the response is running'
    )
    assert.ok(
      await evaluate(
        `document.querySelector('[aria-label="Model reasoning"]').textContent.includes('Checking the passages')`
      )
    )
    assert.match(
      await evaluate(
        `document.querySelector('[aria-label="Response work"] [role="status"] [data-slot="trace-title"]').textContent`
      ),
      /^Working for \d+s$/
    )
    fs.writeFileSync('/tmp/lepis-chat-reasoning.png', (await win.webContents.capturePage()).toPNG())
    await waitFor(
      `document.querySelector('.chat-source') && document.querySelector('.katex') && document.querySelector('[aria-label="Send message"]')`
    )
    assert.equal(
      await evaluate(`document.querySelectorAll('[aria-label="AI answer"] .katex').length`),
      3,
      'dollar, parenthesis and bracket delimiters render as formulas'
    )
    assert.equal(
      await evaluate(`document.querySelectorAll('[aria-label="AI answer"] .katex-display').length`),
      1,
      'bracket delimiters render a display formula'
    )
    await waitFor(
      `document.querySelector('[aria-label="Rename conversation"]').textContent === 'Explain photosynthesis'`
    )
    await waitFor(`!document.querySelector('[aria-label="Rename conversation"]').disabled`)
    await waitFor(
      `document.querySelector('[aria-label="Response activity"]').getAttribute('aria-expanded') === 'false'`
    )
    await click('Response activity')
    await waitFor(
      `document.querySelector('[aria-label="Model reasoning"]').textContent.includes('selected evidence')`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Show tool call: search_document"]').getAttribute('aria-expanded')`
      ),
      'false'
    )
    await click('Show tool call: search_document')
    await waitFor(
      `document.querySelector('[aria-label="Tool call: search_document"]').textContent.includes('photosynthesis')`
    )
    await click('Show tool call: search_document')
    fs.writeFileSync('/tmp/lepis-chat-tools.png', (await win.webContents.capturePage()).toPNG())
    await click('Response activity')
    assert.equal(
      await evaluate(
        `document.querySelectorAll('[aria-label="Response work"] > [data-slot="trace-collapsible"] > [data-slot="trace-collapsible-trigger"]').length`
      ),
      1,
      'one outer toggle for all work'
    )
    assert.ok(
      await evaluate(
        `document.querySelector('[aria-label="Response activity"]').textContent.startsWith('Worked for ')`
      )
    )
    for (const label of ['Your message', 'AI answer']) {
      assert.equal(
        await evaluate(
          `getComputedStyle(document.querySelector('[aria-label="${label}"] .chat-markdown')).fontSize`
        ),
        '20px'
      )
    }
    const recorded = service.store.get(service.store.list('first.pdf')[0].id).messages.at(-1)
    assert.ok(
      recorded.work.parts.some(
        (part) => part.type === 'reasoning' && part.text.includes('selected evidence')
      )
    )
    assert.ok(recorded.work.durationMs > 0)
    assert.deepEqual(
      recorded.work.parts.filter((part) => part.type === 'tool').map((part) => part.tool.name),
      ['read_document', 'search_document']
    )
    console.log(
      'PASS: live reasoning before the answer, auto-collapse, inspectable tools and persistence'
    )
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="Your message"]').dataset.align`),
      'end',
      'user messages align to the right'
    )
    assert.equal(
      await evaluate(
        `/^\\d{1,2}:\\d{2} [AP]M$/.test(document.querySelector('[aria-label="Your message"] time').textContent)`
      ),
      true,
      'user messages show their local relative timestamp'
    )
    assert.equal(
      await evaluate(
        `/^\\d{1,2}:\\d{2} [AP]M$/.test(document.querySelector('[aria-label="AI answer"] time').textContent)`
      ),
      true,
      'assistant messages show their local relative timestamp'
    )
    await waitFor(
      `document.querySelector('[aria-label="Response activity"]')?.getAttribute('aria-expanded') === 'false'`
    )
    await click('Response activity')
    await waitFor(
      `document.querySelector('[data-slot="trace-collapsible-content"]')?.textContent.includes('selected evidence')`
    )
    await click('Response activity')
    await click('Copy message')
    await waitFor(`document.querySelector('[aria-label="Message copied"]')`)
    assert.equal(electron.clipboard.readText(), 'Explain photosynthesis')
    await click('Copy answer')
    await waitFor(`document.querySelector('[aria-label="Answer copied"]')`)
    assert.ok(electron.clipboard.readText().includes('The document discusses'))
    console.log('PASS: aligned messages, collapsible response activity and message copy feedback')
    await click('Rename conversation')

    await waitFor(`document.activeElement?.getAttribute('aria-label') === 'Conversation title'`)
    await setInput('Conversation title', 'Plant energy')
    await evaluate(
      `document.querySelector('[aria-label="Conversation title"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`
    )
    await waitFor(
      `document.querySelector('[aria-label="Rename conversation"]').textContent === 'Plant energy'`
    )
    assert.equal(service.store.list('first.pdf')[0].title, 'Plant energy')
    await click('Rename conversation')
    await setInput('Conversation title', 'Discard this title')
    await evaluate(
      `document.querySelector('[aria-label="Conversation title"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
    )
    await waitFor(
      `document.querySelector('[aria-label="Rename conversation"]')?.textContent === 'Plant energy'`
    )
    await click('Rename conversation')
    await setInput('Conversation title', 'Photosynthesis notes')
    await evaluate(`document.querySelector('[aria-label="Conversation title"]').blur()`)
    await waitFor(
      `document.querySelector('[aria-label="Rename conversation"]')?.textContent === 'Photosynthesis notes'`
    )
    assert.equal(service.store.list('first.pdf')[0].title, 'Photosynthesis notes')
    console.log(
      'PASS: composer model selector and inline title editing with Enter, blur and Escape'
    )
    await evaluate(`document.querySelector('.chat-source').click()`)
    assert.equal(service.store.list('first.pdf').length, 1, 'rapid submits create only one chat')
    assert.equal(
      service.store.get(service.store.list('first.pdf')[0].id).messages.length,
      2,
      'rapid submits send the question only once'
    )
    await waitFor(`document.querySelector('.visible .chat-citation') !== null`)
    assert.equal(
      await evaluate(
        `document.querySelector('.visible .chat-citation').getBoundingClientRect().width > 10`
      ),
      true
    )
    await waitFor(
      `(() => { const citation = document.querySelector('.visible .chat-citation'); return citation && getComputedStyle(citation).animationName === 'chat-citation-fade' && Number(getComputedStyle(citation).opacity) < 0.9; })()`,
      3000
    )
    await waitFor(`document.querySelector('.visible .chat-citation') === null`, 4000)
    console.log(
      'PASS: lazy local indexing, consent, streaming, exact source navigation and math rendering'
    )

    await evaluate(`(() => {
      const schedule = window.requestAnimationFrame;
      window.requestAnimationFrame = callback => { window.__pendingCitation = callback; return 0; };
      document.querySelector('.chat-source').click();
      window.requestAnimationFrame = schedule;
      document.querySelector('[aria-label="second.pdf"]').click();
    })()`)
    await waitFor(
      `document.querySelector('.visible .textLayer')?.textContent.includes('Chlorophyll')`
    )
    await evaluate(`window.__pendingCitation(performance.now()); delete window.__pendingCitation;`)
    await click('first.pdf')
    await waitFor(
      `document.querySelector('.visible .textLayer')?.textContent.includes('Photosynthesis')`
    )

    await click('Toggle AI chat')
    await evaluate(`(() => {
      const span = document.querySelector('.visible .textLayer span');
      span.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      const range = document.createRange(); range.selectNodeContents(span);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    })()`)
    await waitFor(`document.querySelector('[aria-label="Text selection actions"]')`)
    await evaluate(
      `Array.from(document.querySelectorAll('[aria-label="Text selection actions"] button')).find(button => button.textContent.includes('Ask AI')).click()`
    )
    await waitFor(`document.querySelector('[aria-label="Remove selection on page 1"]')`)
    console.log('PASS: Ask AI opens the chat with selected PDF text attached')
    await click('Highlight text')
    await evaluate(`(() => {
      const span = document.querySelector('.visible .textLayer span');
      const range = document.createRange(); range.selectNodeContents(span);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    })()`)
    await waitFor(`document.querySelector('.visible .highlightEditor')`)
    await evaluate(`(() => {
      const data = new DataTransfer(); data.setData('text/plain', 'Unsaved annotation');
      document.querySelector('.visible .pdf-viewer-container').dispatchEvent(new ClipboardEvent('paste', {clipboardData:data, bubbles:true, cancelable:true}));
    })()`)
    await waitFor(`document.querySelector('.visible .freeTextEditor')`)
    await showTextOptions(evaluate, waitFor)
    await waitFor(`document.querySelector('[aria-label="Text color"] [aria-label="Red"]')`)
    await evaluate(`document.querySelector('[aria-label="Text color"] [aria-label="Red"]').click()`)
    await showTextOptions(evaluate, waitFor)
    await evaluate(`(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40;
      const context = canvas.getContext('2d'); context.fillStyle = 'blue'; context.fillRect(0, 0, 80, 40);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const data = new DataTransfer(); data.items.add(new File([blob], 'pasted.png', {type:'image/png'}));
      document.querySelector('.visible .pdf-viewer-container').dispatchEvent(new ClipboardEvent('paste', {clipboardData:data, bubbles:true, cancelable:true}));
    })()`)
    await waitFor(`document.querySelector('.visible .stampEditor canvas')`)
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="first.pdf"] > span.size-2') !== null`),
      true
    )
    await evaluate(
      `document.querySelector('[aria-label="Add attachment"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`
    )
    await waitFor(`document.querySelector('[role="menuitem"]')`)
    await evaluate(
      `Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent.includes('Attach pdf region')).click()`
    )
    await waitFor(`document.querySelector('.visible .chat-region-mode') !== null`)
    const bounds = await evaluate(
      `(() => { const page = document.querySelector('.visible .page').getBoundingClientRect(); return {x:page.left,y:page.top,width:page.width,height:page.height} })()`
    )
    const point = (x, y) => ({
      x: Math.round(bounds.x + x * bounds.width),
      y: Math.round(bounds.y + y * bounds.height)
    })
    const start = point(0.1, 0.08),
      end = point(0.85, 0.7)
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...start,
      button: 'left',
      clickCount: 1
    })
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...end,
      button: 'left',
      buttons: 1
    })
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...end,
      button: 'left',
      clickCount: 1
    })
    await waitFor(
      `document.querySelectorAll('[aria-label="Remove selection on page 1"]').length === 2`
    )
    await waitFor(
      `document.querySelector('img[alt="Page 1 · Region"]')?.src.startsWith('data:image/png')`
    )
    const annotationPixels = await evaluate(`(async () => {
      const image = document.querySelector('img[alt="Page 1 · Region"]'); await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const counts = {highlight:0, text:0, image:0};
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i+1], b = pixels[i+2];
        if (r > 180 && g > 150 && b < 120) counts.highlight++;
        if (r > 150 && g < 100 && b < 100) counts.text++;
        if (b > 200 && r < 50 && g < 50) counts.image++;
      }
      return counts;
    })()`)
    assert.ok(annotationPixels.highlight > 100, 'The region image must include unsaved highlights')
    assert.ok(annotationPixels.text > 10, 'The region image must include unsaved added text')
    assert.ok(annotationPixels.image > 100, 'The region image must include pasted images')
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="first.pdf"] > span.size-2') !== null`),
      true
    )
    await setInput('Message AI', 'Compare these selections')
    await click('Send message')
    await waitFor(
      `document.querySelectorAll('[aria-label="AI answer"]').length === 2 && document.querySelector('[aria-label="Send message"]')`
    )
    const finalRequest = generated.at(-1)
    assert.equal(finalRequest.turns.at(-1).images.length, 1)
    assert.ok(finalRequest.turns.at(-1).text.includes('Selected passages'))
    const firstChat = service.store.list('first.pdf')[0]
    assert.equal(service.store.get(firstChat.id).messages[2].attachments.length, 2)
    assert.equal(service.store.get(firstChat.id).messages[2].attachments[1].kind, 'region')
    console.log(
      'PASS: rectangle selections include unsaved highlights, added text and pasted images in persistent history'
    )

    await evaluate(`document.querySelector('aside:not(.hidden) .chat-source').click()`)
    await waitFor(`document.querySelector('.visible .chat-citation') !== null`)
    fs.writeFileSync('/tmp/lepis-chat-wide.png', (await win.webContents.capturePage()).toPNG())
    const citationWidth = await evaluate(
      `document.querySelector('.visible .chat-citation').getBoundingClientRect().width`
    )
    win.webContents.send('menu:zoom-in')
    await waitFor(
      `document.querySelector('.visible .chat-citation').getBoundingClientRect().width > ${citationWidth}`
    )
    win.webContents.send('menu:rotate-clockwise')
    await waitFor(
      `(() => { const rect = document.querySelector('.visible .chat-citation').getBoundingClientRect(); return rect.height > rect.width })()`
    )
    for (let index = 0; index < 3; index++) win.webContents.send('menu:rotate-clockwise')
    await waitFor(`document.querySelector('.visible .textLayer span') !== null`)
    const highlightsBeforeSave = await evaluate(
      `document.querySelectorAll('.visible .highlightEditor').length`
    )
    await click('Highlight text')
    await evaluate(
      `(() => { const text = document.querySelector('.visible .textLayer span').firstChild; const range = document.createRange(); range.selectNodeContents(text); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); })()`
    )
    await waitFor(
      `document.querySelectorAll('.visible .highlightEditor').length === ${highlightsBeforeSave + 1}`
    )
    const originalLength = files.get('first.pdf').length
    win.webContents.send('menu:save')
    const saveDeadline = Date.now() + 10000
    while (files.get('first.pdf').length === originalLength) {
      if (Date.now() > saveDeadline) throw new Error('Annotation save timed out')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await waitFor(`document.querySelector('[aria-label="first.pdf"] > span.size-2') === null`)
    await click('Highlight text')
    await click('Close first.pdf')
    await waitFor(`document.querySelector('[aria-label="first.pdf"]') === null`)
    for (let index = 0; index < 6; index++) {
      const past = service.store.create(originalVersion, 'chatgpt', 'first.pdf')
      past.messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        text: `Past question ${index + 1}`,
        attachments: [],
        sources: [],
        status: 'complete',
        createdAt: Date.now(),
        model: 'test-model'
      })
      past.title = `Past chat ${index + 1}`
      past.updatedAt = firstChat.updatedAt - (index + 1) * 1000
      service.store.save(past)
    }
    win.webContents.send('file:open-requested', 'first.pdf')
    await waitFor(
      `document.querySelector('.visible .textLayer')?.textContent.includes('Photosynthesis')`
    )
    await waitFor(
      `document.querySelector('aside:not(.hidden) [aria-label="New chat"]')?.disabled === false`
    )
    assert.equal(currentDocument.path, 'first.pdf')
    assert.equal(
      currentDocument.version,
      originalVersion,
      'saved annotations do not change the source content version'
    )
    await waitFor(
      `document.querySelectorAll('aside:not(.hidden) [aria-label="Recent chats"] li').length === 5`
    )
    assert.equal(
      await evaluate(
        `document.querySelectorAll('aside:not(.hidden) [aria-label="AI answer"]').length`
      ),
      0,
      'opening chat shows history instead of automatically loading a conversation'
    )
    assert.deepEqual(
      await evaluate(
        `Array.from(document.querySelectorAll('aside:not(.hidden) [aria-label="Recent chats"] [data-conversation-id]')).map(button => button.textContent)`
      ),
      ['Photosynthesis notes', 'Past chat 1', 'Past chat 2', 'Past chat 3', 'Past chat 4']
    )
    assert.equal(
      await evaluate(`(() => {
      const empty = document.querySelector('aside:not(.hidden) [aria-label="Chat empty state"]');
      const bounds = empty.getBoundingClientRect();
      const content = empty.firstElementChild.getBoundingClientRect();
      return Math.abs(content.x + content.width / 2 - bounds.x - bounds.width / 2) < 2 && Math.abs(content.y + content.height / 2 - bounds.y - bounds.height / 2) < 2;
    })()`),
      true,
      'history is centered horizontally and vertically'
    )
    await setInput('Message AI', 'Draft kept in history')
    await evaluate(
      `Array.from(document.querySelectorAll('aside:not(.hidden) button')).find(button => button.textContent === 'Show more').click()`
    )
    await waitFor(
      `document.querySelectorAll('aside:not(.hidden) [aria-label="All chats"] li').length === 7`
    )
    assert.equal(
      await evaluate(`document.querySelector('aside:not(.hidden) [aria-label="Message AI"]')`),
      null,
      'all-history view has no composer'
    )
    await evaluate(
      `document.querySelector('[aria-label="Chat actions: Past chat 1"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`
    )
    await waitFor(`document.querySelector('[role="menuitem"]')`)
    await evaluate(
      `Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent === 'Rename').click()`
    )
    await waitFor(`document.querySelector('[aria-label="Chat title"]')`)
    await setInput('Chat title', 'Renamed history chat')
    await evaluate(
      `document.querySelector('[aria-label="Chat title"]').closest('form').requestSubmit()`
    )
    await waitFor(`document.querySelector('[aria-label="Chat actions: Renamed history chat"]')`)
    assert.ok(service.store.list('first.pdf').some((chat) => chat.title === 'Renamed history chat'))
    await evaluate(
      `document.querySelector('[aria-label="Chat actions: Past chat 6"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`
    )
    await waitFor(`document.querySelector('[role="menuitem"]')`)
    assert.equal(
      await evaluate(
        `Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent === 'Delete').getAttribute('data-variant')`
      ),
      'destructive'
    )
    assert.equal(
      await evaluate(
        `(() => { const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent === 'Delete'); return getComputedStyle(item).color === getComputedStyle(item.querySelector('svg')).color; })()`
      ),
      true,
      'delete icon uses the same danger color as its label'
    )
    await evaluate(
      `Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent === 'Delete').click()`
    )
    await waitFor(
      `document.querySelector('[role="alertdialog"]')?.textContent.includes('Delete chat?')`
    )
    await waitFor(
      `getComputedStyle(document.querySelector('[role="alertdialog"]')).opacity === '1'`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[role="alertdialog"]').getBoundingClientRect().width <= 320`
      ),
      true
    )
    assert.equal(await evaluate(`document.activeElement?.textContent`), 'Cancel')
    await evaluate(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
    )
    fs.writeFileSync('/tmp/lepis-delete-chat.png', (await win.webContents.capturePage()).toPNG())
    await evaluate(
      `document.querySelector('[role="alertdialog"] [data-variant="destructive"]').click()`
    )
    await waitFor(
      `document.querySelectorAll('aside:not(.hidden) [aria-label="All chats"] li').length === 6`
    )
    assert.equal(
      service.store.list('first.pdf').some((chat) => chat.title === 'Past chat 6'),
      false
    )
    await click('Back to chat')
    await waitFor(
      `document.querySelectorAll('aside:not(.hidden) [aria-label="Recent chats"] li').length === 5`
    )
    await waitFor(`document.activeElement?.getAttribute('aria-label') === 'Message AI'`)
    assert.equal(
      await evaluate(
        `document.querySelector('aside:not(.hidden) [aria-label="Message AI"]').value`
      ),
      'Draft kept in history'
    )
    console.log(
      'PASS: centered recent history, full history without composer, rename, delete and back navigation'
    )
    await evaluate(
      `document.querySelector('aside:not(.hidden) [aria-label="Recent chats"] [data-conversation-id]').click()`
    )
    await waitFor(
      `document.querySelectorAll('aside:not(.hidden) [aria-label="AI answer"]').length === 2`
    )
    console.log(
      'PASS: citation overlays track zoom/rotation; annotated PDFs reopen with the same content version and saved conversations'
    )

    await setInput('Message AI', 'A draft to keep')
    await click('Toggle AI chat')
    await click('Toggle AI chat')
    assert.equal(
      await evaluate(
        `document.querySelector('aside:not(.hidden) [aria-label="Message AI"]').value`
      ),
      'A draft to keep'
    )
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 800,
      height: 850,
      deviceScaleFactor: 1,
      mobile: false
    })
    await waitFor(
      `document.querySelector('.visible .pdf-viewer-container').getBoundingClientRect().width === 0`
    )
    await evaluate(`document.querySelector('.chat-source').click()`)
    await waitFor(
      `document.querySelector('[aria-label="Toggle AI chat"][aria-expanded="false"]') && document.querySelector('.visible .chat-citation') !== null`
    )
    await click('Toggle AI chat')
    await waitFor(
      `document.querySelector('.visible .pdf-viewer-container').getBoundingClientRect().width === 0`
    )
    await evaluate(`(() => {
      const schedule = window.requestAnimationFrame;
      window.requestAnimationFrame = callback => { window.__pendingCitation = callback; return 0; };
      document.querySelector('.chat-source').click();
      window.requestAnimationFrame = schedule;
    })()`)
    await waitFor(
      `document.querySelector('[aria-label="Toggle AI chat"][aria-expanded="false"]') && document.querySelector('.visible .pdf-viewer-container').getBoundingClientRect().width > 0`
    )
    await click('Toggle AI chat')
    await waitFor(
      `document.querySelector('.visible .pdf-viewer-container').getBoundingClientRect().width === 0`
    )
    await evaluate(`window.__pendingCitation(performance.now()); delete window.__pendingCitation;`)
    assert.equal(
      await evaluate(
        `document.querySelector('aside:not(.hidden) [aria-label="Message AI"]').value`
      ),
      'A draft to keep'
    )
    await win.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
    await click('Toggle AI chat')
    win.webContents.send('menu:next-tab')
    await waitFor(
      `document.querySelector('.visible .textLayer')?.textContent.includes('Chlorophyll')`
    )
    await click('Toggle AI chat')
    await waitFor(
      `document.querySelector('aside:not(.hidden) [aria-label="New chat"]')?.disabled === false`
    )
    assert.ok(indexed.some((document) => document.path === 'second.pdf'))
    assert.equal(
      await evaluate(
        `document.querySelectorAll('aside:not(.hidden) [aria-label="AI answer"]').length`
      ),
      0
    )
    assert.notEqual(currentDocument.version, originalVersion)
    console.log(
      'PASS: drafts survive closing and narrow layout; conversations and sources are isolated between tabs'
    )

    await setInput('Message AI', 'Explain chlorophyll')
    cancelAnswer = true
    await waitFor(
      `!document.querySelector('aside:not(.hidden) [aria-label="Send message"]').disabled`
    )
    await evaluate(
      `document.querySelector('aside:not(.hidden) [aria-label="Send message"]').click()`
    )
    await waitFor(
      `document.querySelector('aside:not(.hidden) [aria-label="Stop response"]') && document.querySelector('aside:not(.hidden) [aria-label="AI answer"]')?.textContent.includes('The document')`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('aside:not(.hidden) [aria-label="Message AI"]').value`
      ),
      '',
      'the sent message is removed from the composer as soon as generation starts'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('aside:not(.hidden) [aria-label="Message AI"]').disabled`
      ),
      false,
      'the composer remains editable while an answer streams'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('aside:not(.hidden) [aria-label="AI model"]').disabled`
      ),
      false,
      'the model selector remains enabled while an answer streams'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('aside:not(.hidden) [aria-label="Add attachment"]').disabled`
      ),
      false,
      'attachments remain available while an answer streams'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('aside:not(.hidden) [aria-label="Stop response"] svg').classList.contains('fill-current')`
      ),
      true,
      'the stop control uses a filled square'
    )
    await setInput('Message AI', 'A follow-up drafted during generation')
    await evaluate(
      `document.querySelector('aside:not(.hidden) [aria-label="Stop response"]').click()`
    )
    await waitFor(
      `document.querySelector('aside:not(.hidden)').textContent.includes('Response interrupted')`
    )
    assert.equal(
      service.store.get(service.store.list('second.pdf')[0].id).messages.at(-1).status,
      'stopped'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('aside:not(.hidden) [aria-label="Message AI"]').value`
      ),
      'A follow-up drafted during generation',
      'a draft written during generation survives completion'
    )
    cancelAnswer = false
    await click('first.pdf')
    await waitFor(
      `document.querySelector('.visible .textLayer')?.textContent.includes('Photosynthesis')`
    )
    files.set('first.pdf', pdf('Corrected document content changes the explanation.'))
    mtimes.set('first.pdf', 20)
    await evaluate(`window.dispatchEvent(new Event('focus'))`)
    await waitFor(
      `document.querySelector('.visible .textLayer')?.textContent.includes('Corrected document')`
    )
    await waitFor(
      `document.querySelector('aside:not(.hidden)').textContent.includes('older version')`
    )
    assert.equal(
      await evaluate(`document.querySelector('aside:not(.hidden) .chat-source').disabled`),
      true
    )
    assert.notEqual(currentDocument.version, originalVersion)
    console.log('PASS: externally changed PDF content disables old citation navigation')

    const pageCount = 300
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pageCount} >>`
    ]
    const font = 3 + pageCount * 2
    for (let index = 0; index < pageCount; index++) {
      const content = `BT /F1 16 Tf 72 700 Td (Page ${index + 1}: Photosynthesis and chlorophyll.) Tj ET`
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${4 + index * 2} 0 R >>`,
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
      )
    }
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    files.set('large.pdf', createPdf(objects))
    const started = Date.now()
    win.webContents.send('file:open-requested', 'large.pdf')
    await waitFor(
      `document.querySelector('.visible .textLayer')?.textContent.includes('Page 1: Photosynthesis')`
    )
    await waitFor(
      `document.querySelector('aside:not(.hidden) [aria-label="New chat"]')?.disabled === false`,
      60000
    )
    const large = indexed.at(-1)
    assert.equal(large.path, 'large.pdf')
    assert.equal(large.pages, 300)
    assert.equal(large.sources.length, 300)
    const heap = await evaluate('performance.memory.usedJSHeapSize')
    assert.ok(heap < 256 * 1024 * 1024, `Renderer heap exceeded budget: ${heap}`)
    console.log(
      `PASS: indexed all 300 pages in ${Date.now() - started} ms; renderer heap ${Math.round(heap / 1024 / 1024)} MiB`
    )
    await setInput('Message AI', 'Explain this PDF using OpenAI')
    await click('AI model')
    await click('Select model')
    await waitFor(
      `document.querySelectorAll('[aria-label="Models"] [role="menuitemradio"]').length === 2`
    )
    await evaluate(
      `Array.from(document.querySelectorAll('[aria-label="Models"] [role="menuitemradio"]')).find(option => option.textContent === 'OpenAI test model').click()`
    )
    await waitFor(
      `document.querySelector('aside:not(.hidden) [aria-label="AI model"]').textContent === 'OpenAI test model'`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('aside:not(.hidden) [aria-label="Message AI"]').value`
      ),
      'Explain this PDF using OpenAI'
    )
    await waitFor(
      `!document.querySelector('aside:not(.hidden) [aria-label="Send message"]').disabled`
    )
    await click('Send message')
    await waitFor(
      `document.querySelector('aside:not(.hidden) .katex') && document.querySelector('aside:not(.hidden) [aria-label="Send message"]')`
    )
    assert.equal(generated.at(-1).provider, 'openai')
    assert.equal(generated.at(-1).model, 'test-model')
    assert.equal(service.store.list('large.pdf')[0].provider, 'openai')
    console.log('PASS: choosing another provider preserves the draft and sends with its model')
    const originalChat = service.store.get(service.store.list('large.pdf')[0].id)
    await click('Edit message')
    await setInput('Message text', 'Cancelled edit')
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Cancel').click()`
    )
    assert.deepEqual(service.store.get(originalChat.id), originalChat)
    await click('Edit message')
    await setInput('Message text', 'Explain the plant energy evidence')
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Save & send').click()`
    )
    await waitFor(
      `document.querySelector('[aria-label="Model reasoning"]')?.getAttribute('aria-busy') === 'true'`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('aside:not(.hidden) textarea[aria-label="Message text"]')`
      ),
      null,
      'an accepted edit immediately closes the editor while the replacement answer streams'
    )
    assert.ok(
      await evaluate(
        `document.querySelector('aside:not(.hidden) [aria-label="Your message"]').textContent.includes('Explain the plant energy evidence')`
      ),
      'the edited user bubble immediately shows the replacement text'
    )
    await waitFor(
      `document.querySelector('aside:not(.hidden) [aria-label="Fork conversation"]')?.disabled === false`
    )
    const editedChat = service.store.get(originalChat.id)
    assert.equal(editedChat.messages.length, 2)
    assert.equal(editedChat.messages[0].text, 'Explain the plant energy evidence')
    await click('Fork conversation')
    await waitFor(
      `document.querySelector('aside:not(.hidden) [aria-label="New chat"]').disabled === false && document.body.innerText.includes('(fork)')`
    )
    const forkedChat = service.store.list('large.pdf').find((chat) => chat.id !== originalChat.id)
    assert.ok(forkedChat)
    assert.equal(service.store.get(forkedChat.id).messages.length, 2)
    await setInput('Message AI', 'Continue in the fork')
    await click('Send message')
    await waitFor(
      `document.querySelectorAll('aside:not(.hidden) [aria-label="AI answer"]').length === 2 && document.querySelector('aside:not(.hidden) [aria-label="Send message"]')`
    )
    assert.equal(service.store.get(forkedChat.id).messages.length, 4)
    assert.deepEqual(service.store.get(originalChat.id), editedChat)
    console.log(
      'PASS: inline edit cancellation, save and resend, fork and independent continuation'
    )
    await evaluate(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['External notes about chlorophyll'], 'notes.txt', {type: 'text/plain'}));
      transfer.items.add(new File([new Uint8Array(${JSON.stringify(Array.from(pdf('External PDF about photosynthesis.')))})], 'reference.pdf', {type: 'application/pdf'}));
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 10;
      canvas.getContext('2d').fillRect(0, 0, 10, 10);
      const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0));
      transfer.items.add(new File([bytes], 'figure.png', {type: 'image/png'}));
      window.chatAttachmentFiles = Array.from(transfer.files);
      const input = document.querySelector('aside:not(.hidden) [aria-label="Attach external files"]');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', {bubbles:true}));
    })()`)
    await waitFor(
      `document.querySelector('[aria-label="Remove figure.png"]') && !document.body.innerText.includes('Reading attachments…')`
    )
    await click('Send message')
    await waitFor(
      `document.querySelectorAll('aside:not(.hidden) [aria-label="AI answer"]').length === 3 && document.querySelector('aside:not(.hidden) [aria-label="Send message"]')`
    )
    const external = service.store.get(forkedChat.id).messages.at(-2).attachments
    assert.equal(external.length, 3)
    assert.equal(external[0].name, 'notes.txt')
    assert.ok(external[1].text.includes('External PDF about photosynthesis'))
    assert.ok(external[2].image.startsWith('data:image/png;base64,'))
    assert.ok(generated.at(-1).turns.at(-1).text.includes('External notes'))
    console.log('PASS: external text, PDF and image attachment-only submission and persistence')
    await setInput('Message AI', 'Compare the dropped files')
    await evaluate(`(() => {
      const input = document.querySelector('aside:not(.hidden) [aria-label="Message AI"]');
      const text = new DataTransfer();
      text.setData('text/plain', 'Dragged text');
      input.dispatchEvent(new DragEvent('dragenter', {bubbles:true, cancelable:true, dataTransfer:text}));
    })()`)
    assert.equal(await evaluate(`document.body.innerText.includes('Drop files to attach')`), false)
    await dragChatFiles('dragenter', 'zone')
    await waitFor(`document.body.innerText.includes('Drop files to attach')`)
    await dragChatFiles('dragenter')
    await dragChatFiles('dragleave', 'zone')
    assert.equal(
      await evaluate(`document.body.innerText.includes('Drop files to attach')`),
      true,
      'moving across composer children keeps the drop overlay visible'
    )
    await dragChatFiles('dragleave')
    await waitFor(`!document.body.innerText.includes('Drop files to attach')`)
    const requestsBeforeDrop = generated.length
    await dragChatFiles('dragenter')
    await dragChatFiles('dragover')
    await dragChatFiles('drop')
    await waitFor(
      `document.querySelector('[aria-label="Remove figure.png"]') && !document.body.innerText.includes('Reading attachments…')`
    )
    assert.equal(await evaluate(`document.body.innerText.includes('Drop files to attach')`), false)
    assert.equal(await evaluate(`document.activeElement?.getAttribute('aria-label')`), 'Message AI')
    assert.equal(
      await evaluate(
        `document.querySelector('aside:not(.hidden) [aria-label="Message AI"]').value`
      ),
      'Compare the dropped files'
    )
    assert.equal(
      generated.length,
      requestsBeforeDrop,
      'dropping prepares attachments without sending'
    )
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="large.pdf"] > span.size-2') !== null`),
      false,
      'dropping an image into chat does not annotate the PDF'
    )
    await evaluate(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['binary'], 'unsupported.zip'));
      document.querySelector('aside:not(.hidden) [aria-label="Message AI"]').dispatchEvent(
        new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer:transfer}));
    })()`)
    await waitFor(`document.body.innerText.includes('unsupported.zip: attach')`)
    assert.ok(
      await evaluate(`document.querySelector('[aria-label="Remove figure.png"]') !== null`),
      'a rejected drop preserves existing attachments'
    )
    await click('Send message')
    await waitFor(
      `document.querySelectorAll('aside:not(.hidden) [aria-label="AI answer"]').length === 4 && document.querySelector('aside:not(.hidden) [aria-label="Send message"]')`
    )
    assert.equal(service.store.get(forkedChat.id).messages.at(-2).attachments.length, 3)
    console.log(
      'PASS: file drop overlay, nested drag targets, cancellation, validation and submission without PDF edits'
    )
    await evaluate(`(() => {
      const original = window.createImageBitmap;
      window.restoreImageBitmap = () => { window.createImageBitmap = original; };
      window.createImageBitmap = async (...args) => {
        const bitmap = await original(...args);
        return new Promise(resolve => { window.finishAttachmentRead = () => resolve(bitmap); });
      };
      window.chatAttachmentFiles = window.chatAttachmentFiles.filter(file => file.type === 'image/png');
    })()`)
    await dragChatFiles('drop')
    await waitFor(
      `document.body.innerText.includes('Reading attachments…') && Boolean(window.finishAttachmentRead)`
    )
    await dragChatFiles('dragenter')
    await dragChatFiles('dragover')
    assert.equal(
      await evaluate(`document.body.innerText.includes('Drop files to attach')`),
      false,
      'an active import does not offer another file drop'
    )
    await dragChatFiles('drop')
    await click('New chat')
    await evaluate(`window.restoreImageBitmap(); window.finishAttachmentRead()`)
    await waitFor(`!document.body.innerText.includes('Reading attachments…')`)
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="Remove figure.png"]') !== null`),
      false,
      'finishing an old import does not add attachments to a new chat'
    )
    await dragChatFiles('drop')
    await waitFor(`document.querySelector('[aria-label="Remove figure.png"]')`)
    await click('Remove figure.png')
    console.log('PASS: cancelled imports release the composer and cannot change a new draft')
    assert.deepEqual(rendererErrors, [])
    fs.writeFileSync('/tmp/lepis-chat.png', (await win.webContents.capturePage()).toPNG())
    await click('AI model')
    await click('Select model')
    await waitFor(
      `Array.from(document.querySelectorAll('[aria-label="Models"] [role="menuitemradio"]')).filter(option => option.getBoundingClientRect().width > 0).length === 2`
    )
    await evaluate(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
    )
    await waitFor(`getComputedStyle(document.querySelector('[role="menu"]')).opacity === '1'`)
    fs.writeFileSync('/tmp/lepis-model-groups.png', (await win.webContents.capturePage()).toPNG())
    console.log('PASS: stop persists interrupted responses; no renderer errors')
  })
  .then(() => finish(0))
  .catch((error) => {
    console.error(error)
    finish(1)
  })

function finish(code) {
  win?.destroy()
  service?.dispose()
  service?.store.close()
  modules.dispose()
  fs.rmSync(temp, { recursive: true, force: true })
  app.exit(code)
}
