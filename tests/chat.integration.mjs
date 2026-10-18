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
    `Array.from(document.querySelectorAll('[aria-label="${label}"]')).find(element => element.getBoundingClientRect().width > 0).click()`
  )
const setInput = (label, text) =>
  evaluate(`(() => {
  const input = Array.from(document.querySelectorAll('[aria-label="${label}"]')).find(element => element.getBoundingClientRect().width > 0);
  Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});
  input.dispatchEvent(new Event('input',{bubbles:true}));
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
    const credentials = {
      hostId: 'test',
      keys: {},
      session: { email: 'test@example.invalid', scope: 'chatgpt.tokens.use.direct' }
    }
    service.credentials.load = async () => credentials
    service.credentials.update = async (change) => change(credentials)
    let catalogUnavailable = true
    service.providers.models = async () => {
      if (catalogUnavailable) throw new Error('Fixture catalog temporarily unavailable')
      return [{ id: 'test-model', name: 'Test model' }]
    }
    service.providers.generate = async (request) => {
      generated.push(request)
      if (request.instructions.startsWith('Write ONLY'))
        return JSON.stringify({ scope: 'passages', queries: ['photosynthesis', 'chlorophyll'] })
      const sources = service.store.sources(indexed.at(-1).version)
      const answer = `The document discusses plant energy [[${sources[0].id}]].\n\nThe formula is $E=mc^2$.`
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
    ai('index', (value) => {
      indexed.push(value)
      service.index(value)
    })
    ai('conversations', (value) => service.store.list(value))
    ai('conversation', (id) => service.store.get(id))
    ai('create', (version, provider, filePath) => service.store.create(version, provider, filePath))
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
      directoryName: 'test',
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
    await click('Open AI chat')
    await waitFor(
      `document.querySelector('[aria-label="AI chat panel"]') && document.body.innerText.includes('Allow AI requests')`
    )
    await waitFor(
      `!document.body.innerText.includes('Preparing PDF locally') && document.querySelector('[aria-label="Message AI"]')`
    )
    await waitFor(
      `document.querySelector('aside:not(.hidden) [aria-label="New chat"]')?.disabled === false`
    )
    assert.equal(generated.length, 0, 'opening chat does not call the model')
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Allow AI requests').click()`
    )
    await waitFor(`document.body.innerText.includes('Retry loading models')`)
    catalogUnavailable = false
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Retry loading models')).click()`
    )
    await waitFor(`document.querySelector('[aria-label="AI model"]').value === 'test-model'`)
    assert.equal(
      await evaluate(`document.body.innerText.includes('Fixture catalog temporarily unavailable')`),
      false
    )
    await waitFor(`document.querySelector('[aria-label="AI connections"]') !== null`)
    win.webContents.send('ai:login-state', { phase: 'exchanging-code' })
    await waitFor(`document.body.innerText.includes('Completing authorization')`)
    await click('AI settings')
    win.webContents.send('ai:login-state', { phase: 'verifying-identity' })
    await click('AI settings')
    await waitFor(`document.body.innerText.includes('Verifying your account')`)
    win.webContents.send('ai:login-state', { phase: 'idle' })
    await waitFor(`document.body.innerText.includes('Reconnect ChatGPT')`)
    await click('AI settings')
    await waitFor(`document.querySelector('[aria-label="AI model"]').value === 'test-model'`)
    assert.ok(indexed[0].sources[0].text.includes('Photosynthesis'))
    console.log('PASS: model catalog failures recover and login progress survives closing settings')
    const originalVersion = indexed[0].version
    await setInput('Message AI', 'Explain photosynthesis')
    await waitFor(`!document.querySelector('[aria-label="Send message"]').disabled`)
    await evaluate(`(() => {
      const form = document.querySelector('[aria-label="Message AI"]').closest('form');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    })()`)
    await waitFor(
      `document.querySelector('.chat-source') && document.querySelector('.katex') && document.querySelector('[aria-label="Send message"]')`
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

    await evaluate(
      `(() => { const text = document.querySelector('.visible .textLayer span').firstChild; const range = document.createRange(); range.selectNodeContents(text); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); })()`
    )
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Attach text')).click()`
    )
    await waitFor(`document.querySelector('[aria-label="Remove selection on page 1"]')`)
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Select region')).click()`
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
      end = point(0.85, 0.24)
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
      `document.querySelector('img[alt="Region on page 1"]')?.src.startsWith('data:image/png')`
    )
    assert.equal(await evaluate(`document.querySelector('[data-dirty="true"]') !== null`), false)
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
      'PASS: text and rectangle selections, multiple attachments, original image and persistent history'
    )

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
    await click('Highlight text')
    await evaluate(
      `(() => { const text = document.querySelector('.visible .textLayer span').firstChild; const range = document.createRange(); range.selectNodeContents(text); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); })()`
    )
    await waitFor(`document.querySelector('.visible .highlightEditor') !== null`)
    const originalLength = files.get('first.pdf').length
    win.webContents.send('menu:save')
    const saveDeadline = Date.now() + 10000
    while (files.get('first.pdf').length === originalLength) {
      if (Date.now() > saveDeadline) throw new Error('Annotation save timed out')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await waitFor(`document.querySelector('[aria-label="first.pdf"] > .rounded-full') === null`)
    await click('Highlight text')
    await click('Close first.pdf')
    await waitFor(`document.querySelector('[aria-label="first.pdf"]') === null`)
    win.webContents.send('file:open-requested', 'first.pdf')
    await waitFor(
      `document.querySelector('.visible .textLayer')?.textContent.includes('Photosynthesis')`
    )
    await waitFor(
      `document.querySelector('aside:not(.hidden) [aria-label="New chat"]')?.disabled === false`
    )
    assert.equal(indexed.at(-1).path, 'first.pdf')
    assert.equal(
      indexed.at(-1).version,
      originalVersion,
      'saved annotations do not change the source content version'
    )
    await waitFor(
      `document.querySelectorAll('aside:not(.hidden) [aria-label="AI answer"]').length === 2`
    )
    console.log(
      'PASS: citation overlays track zoom/rotation; annotated PDFs reopen with the same content version and saved conversations'
    )

    await setInput('Message AI', 'A draft to keep')
    await click('Close AI chat')
    await click('Open AI chat')
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
      `document.querySelector('[aria-label="Open AI chat"]') && document.querySelector('.visible .chat-citation') !== null`
    )
    await click('Open AI chat')
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
      `document.querySelector('[aria-label="Open AI chat"]') && document.querySelector('.visible .pdf-viewer-container').getBoundingClientRect().width > 0`
    )
    await click('Open AI chat')
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
    await click('Close AI chat')
    win.webContents.send('menu:next-tab')
    await waitFor(
      `document.querySelector('.visible .textLayer')?.textContent.includes('Chlorophyll')`
    )
    await click('Open AI chat')
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
    assert.notEqual(indexed.at(-1).version, originalVersion)
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
    assert.notEqual(indexed.at(-1).version, originalVersion)
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
    assert.deepEqual(rendererErrors, [])
    fs.writeFileSync('/tmp/lepis-chat.png', (await win.webContents.capturePage()).toPNG())
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
