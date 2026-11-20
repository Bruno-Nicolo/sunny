import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { aiModules } from './fixtures/ai-modules.mjs'

const modules = aiModules()
after(() => modules.dispose())
const { ChatStore, defaultAiSettings } = modules.load('store')
const { AiService } = modules.load('service')
const { AiProviders } = modules.load('providers')
const { CredentialStore } = modules.load('credentials')
const { validatedAnswer, historyTurns, parseSearchPlan } = modules.load('context')
const { validateAttachments } = modules.loadShared('chat-attachments')
const { formatChatMessageTime } = modules.loadShared('chat-time')
const reasoningText = (message) =>
  message.work?.parts
    .filter((part) => part.type === 'reasoning')
    .map((part) => part.text)
    .join('') || undefined
const toolCalls = (message) =>
  message.work?.parts.filter((part) => part.type === 'tool').map((part) => part.tool) ?? []
const version = 'a'.repeat(64)
const sources = [
  {
    id: 'p1s1',
    page: 1,
    text: 'Photosynthesis converts light into chemical energy.',
    rects: [[10, 20, 200, 40]]
  },
  {
    id: 'p2s1',
    page: 2,
    text: 'Chlorophyll absorbs sunlight in plant cells.',
    rects: [[10, 20, 200, 40]]
  }
]
const document = {
  indexKey: 'e'.repeat(64),
  version,
  path: '/test/biology.pdf',
  name: 'biology.pdf',
  pages: 2,
  sources
}

test('message times use calendar-relative labels and include the year when needed', () => {
  const now = new Date(2026, 9, 23, 22, 0).getTime()
  assert.equal(formatChatMessageTime(new Date(2026, 9, 23, 20, 30).getTime(), now), '8:30 PM')
  assert.equal(
    formatChatMessageTime(new Date(2026, 9, 22, 20, 30).getTime(), now),
    'Yesterday 8:30 PM'
  )
  assert.equal(
    formatChatMessageTime(new Date(2026, 9, 20, 20, 30).getTime(), now),
    'Tuesday 8:30 PM'
  )
  assert.equal(
    formatChatMessageTime(new Date(2026, 9, 10, 20, 30).getTime(), now),
    'Oct 10, 8:30 PM'
  )
  assert.equal(
    formatChatMessageTime(new Date(2025, 9, 10, 20, 30).getTime(), now),
    'Oct 10, 2025, 8:30 PM'
  )
})

test('work preserves reasoning/tool/reasoning order and updates a tool without moving it', () => {
  const { applyChatEvent } = modules.loadShared('chat-work')
  const base = { requestId: 'request', conversationId: 'chat', messageId: 'assistant' }
  const assistant = {
    ...userMessage(),
    id: 'assistant',
    role: 'assistant',
    text: '',
    status: 'streaming',
    work: { parts: [], durationMs: 0 }
  }
  const events = [
    { ...base, type: 'message', message: assistant },
    { ...base, type: 'reasoning-delta', text: 'I need more evidence. ' },
    { ...base, type: 'reasoning-delta', text: 'Searching the document.' },
    {
      ...base,
      type: 'tool',
      tool: {
        id: 'search',
        name: 'search_document',
        input: { queries: ['energy'] },
        status: 'running'
      }
    },
    { ...base, type: 'reasoning-delta', text: 'Comparing the available passages.' },
    {
      ...base,
      type: 'tool',
      tool: {
        id: 'search',
        name: 'search_document',
        input: { queries: ['energy'] },
        status: 'complete',
        output: 'Two passages found.'
      }
    },
    { ...base, type: 'reasoning-delta', text: ' The result supports the answer.' }
  ]
  const messages = events.reduce(applyChatEvent, [])
  const work = messages[0].work
  assert.deepEqual(
    work.parts.map((part) => part.type),
    ['reasoning', 'tool', 'reasoning']
  )
  assert.equal(work.parts[0].text, 'I need more evidence. Searching the document.')
  assert.equal(work.parts[1].tool.status, 'complete')
  assert.equal(
    work.parts[2].text,
    'Comparing the available passages. The result supports the answer.'
  )
  assert.equal(assistant.work.parts.length, 0, 'stream updates never mutate the original event')
  const finished = { ...messages[0], status: 'complete', work: { ...work, durationMs: 71000 } }
  assert.deepEqual(
    applyChatEvent(messages, { ...base, type: 'finished', message: finished })[0].work,
    finished.work
  )
})

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-ai-'))
  const service = new AiService(directory)
  service.credentials.load = async () => ({ hostId: 'test', keys: { openai: 'fake-test-key' } })
  service.credentials.update = async () => {}
  service.settings({ ...defaultAiSettings, consent: true, provider: 'openai' })
  service.index(document)
  t.after(() => {
    service.dispose()
    service.store.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return service
}
function userMessage(text = 'A saved question') {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    text,
    attachments: [],
    sources: [],
    status: 'complete',
    createdAt: Date.now(),
    model: 'test-model'
  }
}
function emitSearchPlan(params, queries = ['photosynthesis']) {
  params.onUpdate({ type: 'delta', text: JSON.stringify({ scope: 'passages', queries }) })
}

function request(chat, overrides = {}) {
  return {
    requestId: crypto.randomUUID(),
    conversationId: chat.id,
    newConversation: overrides.retryMessageId
      ? undefined
      : { version: chat.documentVersion, path: chat.documentPath, provider: chat.provider },
    model: 'test-model',
    text: 'Explain photosynthesis',
    attachments: [],
    summarize: false,
    ...overrides
  }
}

test('conversations are persisted only with the first user message, including provider failures', async (t) => {
  const service = setup(t)
  const chat = service.store.create(version, 'openai', document.path)
  assert.deepEqual(service.store.list(document.path), [])
  assert.throws(() => service.store.save(chat), /user message/)
  await assert.rejects(
    service.send(request(chat, { text: '' }), () => {}),
    /Write a message/
  )
  assert.deepEqual(service.store.list(document.path), [])
  service.providers.generate = async () => {
    throw new Error('Provider unavailable')
  }
  await service.send(request(chat), (event) => {
    if (event.type === 'message')
      assert.ok(service.store.get(chat.id).messages.some((message) => message.role === 'user'))
  })
  assert.equal(service.store.list(document.path).length, 1)
  assert.equal(service.store.get(chat.id).title, 'Explain photosynthesis')
  assert.equal(service.store.get(chat.id).messages.at(-1).status, 'error')
  service.store.rename(chat.id, 'New chat')
  await service.send(
    request(chat, { newConversation: undefined, text: 'Another question' }),
    () => {}
  )
  assert.equal(
    service.store.get(chat.id).title,
    'New chat',
    'a saved title is not treated as a placeholder'
  )
})

test('opening a cached PDF activates its path for chat without resubmitting passages', async (t) => {
  const service = setup(t)
  const file = { path: '/test/cached-copy.pdf', name: 'cached-copy.pdf' }
  const metadata = { indexKey: document.indexKey, version, pages: document.pages }
  assert.deepEqual(service.openDocument(document.indexKey, file), { ...metadata, ...file })
  service.providers.generate = async (request) => {
    if (request.instructions.startsWith('Write ONLY')) return emitSearchPlan(request)
    request.onUpdate({ type: 'delta', text: 'Light becomes energy [[p1s1]].' })
  }
  const chat = service.store.create(version, 'openai', file.path)
  await service.send(request(chat), () => {})
  assert.equal(service.store.get(chat.id).messages.at(-1).status, 'complete')
  assert.equal(service.store.get(chat.id).documentName, file.name)
})

test('local retrieval is version-scoped, parameterized and retains citation geometry', (t) => {
  const service = setup(t)
  service.index({
    ...document,
    version: 'b'.repeat(64),
    path: '/test/other.pdf',
    sources: [{ ...sources[0], text: 'Photosynthesis: unrelated second document' }]
  })
  const found = service.store.search(version, ['photosynthesis " OR 1=1'])
  assert.equal(found[0].text, sources[0].text)
  assert.deepEqual(found[0].rects, sources[0].rects)
  assert.equal(
    found.some((source) => source.text.includes('unrelated')),
    false
  )
  assert.deepEqual(service.store.search(version, ['unfindableword']), [])
})

test('all direct search hits precede neighboring passages in the context budget', (t) => {
  const service = setup(t)
  const many = Array.from({ length: 60 }, (_, index) => ({
    id: `p${index + 1}s1`,
    page: index + 1,
    text: index % 4 === 0 ? 'MATCHTERM supporting evidence' : 'Neighboring explanation',
    rects: [[10, 20, 200, 40]]
  }))
  service.index({ ...document, version: 'd'.repeat(64), pages: 60, sources: many })
  const found = service.store.search('d'.repeat(64), ['MATCHTERM'])
  assert.equal(
    found.slice(0, 15).every((source) => source.text.includes('MATCHTERM')),
    true
  )
})

test('chat streams, validates references, persists selections and remains isolated per document', async (t) => {
  const service = setup(t)
  const calls = []
  service.providers.generate = async (request) => {
    calls.push(request)
    if (request.instructions.startsWith('Write ONLY')) {
      request.onUpdate({ type: 'reasoning-delta', text: 'Planning the document search.' })
      return emitSearchPlan(request, ['photosynthesis', 'chlorophyll'])
    }
    request.onUpdate({ type: 'reasoning-delta', text: 'Checking the cited passages. ' })
    request.onUpdate({ type: 'commentary-delta', id: 'update', text: 'I’ll compare ' })
    request.onUpdate({ type: 'commentary-delta', id: 'update', text: 'the matching passages.' })
    request.onUpdate({ type: 'reasoning-delta', text: 'The evidence supports the answer.' })
    request.onUpdate({ type: 'delta', text: 'Light becomes energy [[p1s1]]. ' })
    request.onUpdate({ type: 'delta', text: 'Unsupported [[invented]].' })
  }
  const chat = service.store.create(version, 'openai', document.path)
  const attachment = { ...sources[0], id: 'a_text', kind: 'text' }
  const events = []
  await service.send(request(chat, { attachments: [attachment], reasoning: 'high' }), (event) =>
    events.push(structuredClone(event))
  )
  const saved = service.store.get(chat.id)
  assert.ok(calls.length > 1)
  assert.ok(calls.every((call) => call.reasoning === 'high'))
  assert.equal(saved.messages.length, 2)
  assert.deepEqual(saved.messages[0].attachments, [attachment])
  assert.equal(saved.messages[1].status, 'complete')
  assert.equal(
    reasoningText(saved.messages[1]),
    'Planning the document search.Checking the cited passages. The evidence supports the answer.'
  )
  assert.equal(events.filter((event) => event.type === 'reasoning-delta').length, 3)
  assert.deepEqual(saved.messages[1].work.parts.slice(-3), [
    { type: 'reasoning', text: 'Checking the cited passages. ' },
    { type: 'commentary', id: 'update', text: 'I’ll compare the matching passages.' },
    { type: 'reasoning', text: 'The evidence supports the answer.' }
  ])
  assert.deepEqual(
    events.filter((event) => event.type === 'commentary-delta').map((event) => event.text),
    ['I’ll compare ', 'the matching passages.']
  )
  assert.deepEqual(
    toolCalls(saved.messages[1]).map((tool) => [tool.name, tool.status]),
    [
      ['read_document', 'complete'],
      ['search_document', 'complete']
    ]
  )
  assert.equal(events.filter((event) => event.type === 'tool').length, 4)
  assert.ok(toolCalls(saved.messages[1])[1].input.queries.includes('photosynthesis'))
  assert.ok(toolCalls(saved.messages[1])[1].output.includes('Chlorophyll'))
  assert.match(saved.messages[1].text, /\[\[p1s1\]\]/)
  assert.match(saved.messages[1].text, /reference unavailable/)
  assert.deepEqual(saved.messages[1].sources, [sources[0]])
  assert.equal(events.filter((event) => event.type === 'delta').length, 2)
  assert.equal(events.at(-1).type, 'finished')
  assert.equal(calls.at(-1).provider, 'openai')
  assert.match(calls.at(-1).turns.at(-1).text, /a_text/)
  assert.deepEqual(service.store.list('/test/other.pdf'), [])
})

test('consent, attachment budgets and changed document versions block requests before provider calls', async (t) => {
  const service = setup(t)
  let calls = 0
  service.providers.generate = async () => {
    calls++
  }
  const chat = service.store.create(version, 'openai', document.path)
  service.settings({ ...defaultAiSettings, consent: false })
  await assert.rejects(
    service.send(request(chat), () => {}),
    /notice/
  )
  service.settings({ ...defaultAiSettings, consent: true })
  const selection = {
    ...sources[0],
    id: 'a_large',
    kind: 'region',
    image: `data:image/png;base64,${'A'.repeat(9 * 1024 * 1024)}`
  }
  await assert.rejects(
    service.send(request(chat, { attachments: [selection] }), () => {}),
    /budget/
  )
  service.index({ ...document, version: 'c'.repeat(64) })
  await assert.rejects(
    service.send(request(chat), () => {}),
    /PDF changed/
  )
  assert.equal(calls, 0)
  assert.deepEqual(service.store.list(document.path), [])
  assert.throws(() => service.store.get(chat.id), /not found/)
})

test('tool failures are streamed and saved with the failed assistant response', async (t) => {
  const service = setup(t)
  service.providers.generate = async (params) => emitSearchPlan(params, ['plant'])
  service.store.search = () => {
    throw new Error('Search index unavailable')
  }
  const chat = service.store.create(version, 'openai', document.path)
  const events = []
  await service.send(request(chat), (event) => events.push(structuredClone(event)))
  const answer = service.store.get(chat.id).messages.at(-1)
  assert.equal(answer.status, 'error')
  assert.equal(toolCalls(answer).at(-1).status, 'error')
  assert.equal(toolCalls(answer).at(-1).error, 'Search index unavailable')
  assert.deepEqual(
    events
      .filter((event) => event.type === 'tool' && event.tool.name === 'search_document')
      .map((event) => event.tool.status),
    ['running', 'error']
  )
})

test('stop stores an interrupted answer and retry replaces it without duplicating the user', async (t) => {
  const service = setup(t)
  const chat = service.store.create(version, 'openai', document.path)
  const sending = request(chat)
  service.providers.generate = async (params) => {
    if (params.instructions.startsWith('Write ONLY')) return emitSearchPlan(params)
    params.onUpdate({ type: 'reasoning-delta', text: 'Partial reasoning' })
    service.stop(sending.requestId)
    params.signal.throwIfAborted()
  }
  await service.send(sending, () => {})
  let saved = service.store.get(chat.id)
  assert.equal(saved.messages.at(-1).status, 'stopped')
  assert.equal(reasoningText(saved.messages.at(-1)), 'Partial reasoning')
  assert.equal(saved.messages.at(-1).text, '')
  const retryMessageId = saved.messages.at(-1).id
  service.providers.generate = async (params) => {
    if (params.instructions.startsWith('Write ONLY')) return emitSearchPlan(params)
    params.onUpdate({ type: 'delta', text: 'Complete [[p1s1]]' })
  }
  await service.send(request(chat, { retryMessageId }), () => {})
  saved = service.store.get(chat.id)
  assert.equal(saved.messages.length, 2)
  assert.equal(saved.messages.at(-1).status, 'complete')
  assert.equal(reasoningText(saved.messages.at(-1)), undefined)
  assert.equal(saved.messages[0].text, sending.text)
})

test('global summaries visit every source group and retry keeps the summary mode', async (t) => {
  const service = setup(t)
  const manySources = Array.from({ length: 60 }, (_, index) => ({
    ...sources[0],
    id: `p${index + 1}s1`,
    page: index + 1,
    text: `SECTION_${index + 1} ` + 'Content '.repeat(110)
  }))
  service.index({ ...document, version: 'd'.repeat(64), pages: 60, sources: manySources })
  const chat = service.store.create('d'.repeat(64), 'openai', document.path)
  const sections = []
  let fail = true
  service.providers.generate = async (params) => {
    if (params.instructions.includes('Summarize this part')) {
      sections.push(params.turns[0].text)
      return params.onUpdate({ type: 'delta', text: 'Section summary [[p1s1]]' })
    }
    if (fail) throw new Error('test interruption')
    params.onUpdate({ type: 'delta', text: 'Full synthesis [[p1s1]]' })
  }
  await service.send(request(chat, { summarize: true }), () => {})
  assert.equal(service.store.get(chat.id).messages.at(-1).status, 'error')
  for (const source of manySources)
    assert.ok(sections.some((section) => section.includes(`SECTION_${source.page} `)))
  const originalGroups = sections.length
  fail = false
  await service.send(
    request(chat, { retryMessageId: service.store.get(chat.id).messages.at(-1).id }),
    () => {}
  )
  assert.equal(sections.length, originalGroups * 2)
  assert.equal(service.store.get(chat.id).messages.at(-1).status, 'complete')
})

test('restart retains conversations and converts unfinished responses to interrupted', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-ai-restart-'))
  let store = new ChatStore(directory)
  t.after(() => {
    store.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  store.setSettings({ ...defaultAiSettings, chatFontSize: 18 })
  store.index(document)
  const chat = store.create(version, 'chatgpt', document.path)
  chat.messages.push(userMessage())
  chat.messages.push({
    id: 'answer',
    role: 'assistant',
    text: 'Partial',
    work: {
      parts: [
        { type: 'reasoning', text: 'Checking evidence before interruption.' },
        { type: 'tool', tool: { id: 'lookup', name: 'lookup', input: {}, status: 'running' } }
      ],
      durationMs: 2500
    },
    attachments: [],
    sources: [],
    status: 'streaming',
    createdAt: 1,
    model: 'test'
  })
  store.save(chat)
  store.close()
  store = new ChatStore(directory)
  assert.equal(store.settings().chatFontSize, 18)
  assert.equal(store.get(chat.id).messages[1].status, 'stopped')
  assert.equal(toolCalls(store.get(chat.id).messages[1])[0].status, 'stopped')
  assert.equal(
    reasoningText(store.get(chat.id).messages[1]),
    'Checking evidence before interruption.'
  )
  store.rename(chat.id, 'Study notes')
  assert.equal(store.list(document.path)[0].title, 'Study notes')
  store.remove(chat.id)
  assert.deepEqual(store.list(document.path), [])
})

test('citation validation rejects fabricated IDs and history keeps complete exchanges', () => {
  assert.deepEqual(validatedAnswer('Claim [[p1s1]] [[wrong]]', sources), {
    text: 'Claim [[p1s1]] (reference unavailable)',
    sources: [sources[0]]
  })
  assert.throws(
    () => validateAttachments([{ ...sources[0], id: 'a_bad', kind: 'region' }]),
    /image/
  )
  const messages = [
    { id: '1', role: 'user', text: 'Question', attachments: [], sources: [], status: 'complete' },
    { id: '2', role: 'assistant', text: 'Answer', attachments: [], sources: [], status: 'complete' }
  ]
  assert.deepEqual(
    historyTurns(messages).map((turn) => turn.role),
    ['user', 'assistant']
  )
  assert.deepEqual(
    historyTurns([
      ...messages,
      { ...messages[0], text: 'Failed question' },
      { ...messages[1], status: 'error' }
    ]),
    historyTurns(messages)
  )
})

test('identical PDF copies keep separate conversation ownership', (t) => {
  const service = setup(t)
  const first = service.store.create(version, 'chatgpt', document.path)
  service.index({ ...document, path: '/test/copy.pdf', name: 'copy.pdf' })
  const second = service.store.create(version, 'chatgpt', '/test/copy.pdf')
  for (const chat of [first, second]) {
    chat.messages.push(userMessage())
    service.store.save(chat)
  }
  assert.equal(first.documentPath, document.path)
  assert.equal(second.documentPath, '/test/copy.pdf')
  assert.deepEqual(
    service.store.list(document.path).map((chat) => chat.id),
    [first.id]
  )
  assert.deepEqual(
    service.store.list('/test/copy.pdf').map((chat) => chat.id),
    [second.id]
  )
})

test('independent preference updates preserve chat text size, panel width and model choices', (t) => {
  const service = setup(t)
  service.settings({ chatFontSize: 20 })
  service.settings({ panelWidth: 460 })
  service.settings({
    models: { openai: 'first-model' },
    reasoning: { 'openai:first-model': 'high' }
  })
  service.settings({ reasoning: { 'google:second-model': 'low' } })
  service.settings({ provider: 'google', models: { google: 'second-model' } })
  const settings = service.store.settings()
  assert.equal(settings.chatFontSize, 20)
  assert.equal(settings.panelWidth, 460)
  assert.equal(settings.models.openai, 'first-model')
  assert.equal(settings.models.google, 'second-model')
  assert.deepEqual(settings.reasoning, {
    'openai:first-model': 'high',
    'google:second-model': 'low'
  })
  assert.throws(
    () => service.settings({ reasoning: { 'openai:first-model': 'invalid' } }),
    /Invalid reasoning level/
  )
})

test('chat text size defaults to 14, clamps to readable bounds and rejects invalid values', (t) => {
  const service = setup(t)
  assert.equal(service.store.settings().chatFontSize, 14)
  service.settings({ chatFontSize: 100 })
  assert.equal(service.store.settings().chatFontSize, 24)
  service.settings({ chatFontSize: 1 })
  assert.equal(service.store.settings().chatFontSize, 12)
  for (const chatFontSize of [NaN, Infinity, '18', null, 15.5]) {
    assert.throws(() => service.settings({ chatFontSize }), /Invalid AI settings/)
  }
  assert.equal(service.store.settings().chatFontSize, 12)
})

test('search planning rejects malformed output instead of silently using an incomplete context', () => {
  assert.deepEqual(parseSearchPlan('{"scope":"document","queries":[]}'), {
    scope: 'document',
    queries: []
  })
  assert.throws(() => parseSearchPlan('Use the whole document'), /valid document search/)
  assert.throws(() => parseSearchPlan('{"scope":"other","queries":[]}'), /valid document search/)
})

test('concurrent first credential reads share one stable installation identity', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-ai-identity-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new CredentialStore(directory)
  const values = await Promise.all(Array.from({ length: 8 }, () => store.load()))
  assert.match(values[0].hostId, /^urn:uuid:/)
  for (const value of values) assert.equal(value, values[0])
})

test('Anthropic model catalog includes subsequent pages', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const seen = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    seen.push(url)
    const second = url.searchParams.has('after_id')
    const id = second ? 'claude-second' : 'claude-first'
    return Response.json({
      data: [
        {
          id,
          display_name: id,
          lifecycle: 'active',
          capabilities: { image_input: { supported: true } },
          max_tokens: 8192
        }
      ],
      has_more: !second,
      first_id: id,
      last_id: id
    })
  }
  const adapters = new AiProviders(
    { load: async () => ({ keys: { anthropic: 'fixture-key' } }) },
    {}
  )
  assert.deepEqual(
    (await adapters.models('anthropic')).map((model) => model.id),
    ['claude-first', 'claude-second']
  )
  assert.equal(seen.length, 2)
})

test('official SDK adapters send inline images and require terminal completion', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const adapters = new AiProviders(
    {
      load: async () => ({
        keys: {
          openai: 'test-key',
          anthropic: 'test-key',
          google: 'test-key',
          openrouter: 'test-key'
        }
      })
    },
    { token: async () => 'test-oauth-token' }
  )
  const calls = []
  let incomplete = false
  let refused = false
  const sse = (events) =>
    new Response(
      events
        .map(
          (event) =>
            `${event.type ? `event: ${event.type}\n` : ''}data: ${JSON.stringify(event)}\n\n`
        )
        .join(''),
      { headers: { 'Content-Type': 'text/event-stream' } }
    )
  globalThis.fetch = async (input, options) => {
    const url = String(input)
    if (!options.body) {
      if (url.includes('api.anthropic.com'))
        return Response.json({
          data: [
            {
              id: 'test-model',
              display_name: 'Test',
              lifecycle: 'active',
              max_tokens: 8192,
              capabilities: {
                image_input: { supported: true },
                thinking: { types: { adaptive: { supported: true } } }
              }
            }
          ],
          has_more: false
        })
      if (url.includes('generativelanguage.googleapis.com'))
        return Response.json({
          models: [
            {
              name: 'models/gemini-3-flash',
              displayName: 'Test',
              thinking: true,
              supportedGenerationMethods: ['generateContent']
            }
          ]
        })
      if (url.includes('openrouter.ai'))
        return Response.json({
          data: [
            {
              id: 'test-model',
              name: 'Test',
              architecture: { input_modalities: ['text', 'image'] },
              supported_parameters: ['reasoning']
            }
          ]
        })
      throw new Error(`Unexpected catalog ${url}`)
    }
    const body = JSON.parse(options.body)
    calls.push({ url, body })
    if (url.endsWith('/responses') && refused)
      return sse([
        { type: 'response.refusal.delta', delta: 'The request was declined.' },
        { type: 'response.completed', response: { output: [] } }
      ])
    if (url.endsWith('/responses'))
      return sse([
        ...(calls.length === 2
          ? [
              {
                type: 'response.reasoning_summary_text.delta',
                item_id: 'r1',
                summary_index: 0,
                delta: 'Checking '
              },
              {
                type: 'response.reasoning_summary_text.done',
                item_id: 'r1',
                summary_index: 0,
                text: 'Checking evidence.'
              }
            ]
          : []),
        {
          type: 'response.output_item.added',
          item: {
            type: 'message',
            id: 'update',
            role: 'assistant',
            phase: 'commentary',
            content: []
          }
        },
        { type: 'response.output_text.delta', item_id: 'update', delta: 'Comparing ' },
        { type: 'response.output_text.delta', item_id: 'update', delta: 'the evidence.' },
        ...['added', 'done'].map((phase) => ({
          type: `response.output_item.${phase}`,
          item: {
            type: 'function_call',
            call_id: 'tool-1',
            name: 'lookup',
            arguments: phase === 'done' ? '{"term":"light"}' : ''
          }
        })),
        { type: 'response.output_text.delta', item_id: 'answer', delta: 'Answer' },
        {
          type: incomplete ? 'response.incomplete' : 'response.completed',
          response: {
            output: [
              {
                id: 'r1',
                type: 'reasoning',
                summary: [
                  { type: 'summary_text', text: 'Checking evidence.' },
                  { type: 'summary_text', text: 'Comparing sources.' }
                ]
              }
            ]
          }
        }
      ])
    if (url.endsWith('/messages'))
      return sse([
        {
          type: 'message_start',
          message: {
            id: 'test',
            type: 'message',
            role: 'assistant',
            model: 'test',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 0 }
          }
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: 'Checking ', signature: '' }
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'evidence.' }
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'private-signature' }
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'tool-1', name: 'lookup', input: {} }
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"term":"light"}' }
        },
        { type: 'content_block_stop', index: 1 },
        { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Answer' } },
        { type: 'content_block_stop', index: 2 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 1 }
        },
        { type: 'message_stop' }
      ])
    if (url.includes('generativelanguage.googleapis.com'))
      return sse([
        {
          candidates: [
            {
              index: 0,
              content: {
                role: 'model',
                parts: [
                  { text: 'Checking evidence.', thought: true },
                  { functionCall: { id: 'tool-1', name: 'lookup', args: { term: 'light' } } },
                  { text: 'Answer', thoughtSignature: 'private-signature' }
                ]
              },
              finishReason: 'STOP'
            }
          ]
        }
      ])
    if (url.endsWith('/chat/completions'))
      return sse([
        {
          id: 'test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'test',
          choices: [
            {
              index: 0,
              delta: {
                reasoning: 'Checking ',
                tool_calls: [
                  { index: 0, id: 'tool-1', function: { name: 'lookup', arguments: '{"term":' } }
                ]
              },
              finish_reason: null
            }
          ]
        },
        {
          id: 'test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'test',
          choices: [
            {
              index: 0,
              delta: {
                reasoning: 'evi',
                tool_calls: [{ index: 0, function: { arguments: '"light"}' } }],
                reasoning_details: [
                  { type: 'reasoning.text', text: 'evi' },
                  { type: 'reasoning.summary', summary: 'dence.' },
                  { type: 'reasoning.encrypted', data: 'private-encrypted-reasoning' }
                ],
                content: 'Answer'
              },
              finish_reason: 'stop'
            }
          ]
        }
      ])
    throw new Error(`Unexpected endpoint ${url}`)
  }
  for (const provider of ['anthropic', 'google', 'openrouter'])
    assert.equal((await adapters.models(provider)).length, 1, provider)
  const results = {}
  for (const [provider, model, effort] of [
    ['chatgpt', 'gpt-6.1-sol', 'high'],
    ['openai', 'gpt-6.1-sol', 'low'],
    ['anthropic', 'test-model', 'high'],
    ['google', 'gemini-3-flash', 'medium'],
    ['openrouter', 'test-model', 'low']
  ]) {
    let streamed = ''
    let reasoning = ''
    const commentary = []
    const tools = []
    await adapters.generate({
      provider,
      model,
      reasoning: effort,
      instructions: 'Use citations',
      turns: [{ role: 'user', text: 'Explain', images: ['data:image/png;base64,AAAA'] }],
      signal: new AbortController().signal,
      onUpdate: (update) => {
        if (update.type === 'delta') streamed += update.text
        if (update.type === 'reasoning-delta') reasoning += update.text
        if (update.type === 'commentary-delta')
          commentary.push({ id: update.id, text: update.text })
        if (update.type === 'tool') tools.push(update.tool)
      }
    })
    assert.equal(streamed, 'Answer', provider)
    assert.deepEqual(
      tools.map((tool) => tool.status),
      provider === 'google' ? ['requested'] : ['running', 'requested'],
      provider
    )
    assert.equal(tools.at(-1).name, 'lookup', provider)
    assert.equal(tools.at(-1).id, 'tool-1', provider)
    const input = tools.at(-1).input
    assert.deepEqual(typeof input === 'string' ? JSON.parse(input) : input, { term: 'light' })
    assert.deepEqual(
      commentary,
      provider === 'chatgpt' || provider === 'openai'
        ? [
            { id: 'update', text: 'Comparing ' },
            { id: 'update', text: 'the evidence.' }
          ]
        : [],
      provider
    )
    results[provider] = reasoning
  }
  const openAiSummary = 'Checking evidence.\n\nComparing sources.'
  assert.deepEqual(results, {
    chatgpt: openAiSummary,
    openai: openAiSummary,
    anthropic: 'Checking evidence.',
    google: 'Checking evidence.',
    openrouter: 'Checking evidence.'
  })
  for (const call of calls.slice(0, 2)) {
    assert.equal(call.url, 'https://api.openai.com/v1/responses')
    assert.equal(call.body.store, false)
    assert.equal(call.body.stream, true)
    assert.deepEqual(call.body.reasoning, {
      summary: 'auto',
      effort: call === calls[0] ? 'high' : 'low'
    })
    assert.equal(call.body.input[0].content[1].image_url, 'data:image/png;base64,AAAA')
    for (const field of [
      'previous_response_id',
      'temperature',
      'max_output_tokens',
      'conversation',
      'metadata'
    ])
      assert.equal(field in call.body, false)
  }
  assert.equal(calls[2].body.messages[0].content[1].source.media_type, 'image/png')
  assert.deepEqual(calls[2].body.thinking, { type: 'adaptive', display: 'summarized' })
  assert.deepEqual(calls[2].body.output_config, { effort: 'high' })
  assert.equal(calls[3].body.contents[0].parts[1].inlineData.mimeType, 'image/png')
  assert.deepEqual(calls[3].body.generationConfig.thinkingConfig, {
    includeThoughts: true,
    thinkingLevel: 'MEDIUM'
  })
  assert.equal(calls[4].body.messages[1].content[1].image_url.url, 'data:image/png;base64,AAAA')
  assert.deepEqual(calls[4].body.reasoning, { enabled: true, exclude: false, effort: 'low' })
  incomplete = true
  await assert.rejects(
    adapters.generate({
      provider: 'chatgpt',
      model: 'test',
      instructions: '',
      turns: [{ role: 'user', text: 'Question' }],
      signal: new AbortController().signal,
      onUpdate: () => {}
    }),
    /incomplete/
  )
  refused = true
  await assert.rejects(
    adapters.generate({
      provider: 'openai',
      model: 'test',
      instructions: '',
      turns: [{ role: 'user', text: 'Question' }],
      signal: new AbortController().signal,
      onUpdate: () => assert.fail('Refusal should surface as a response error')
    }),
    /The request was declined/
  )
})

test('editing truncates later turns, preserves selections and streams the replacement history', async (t) => {
  const service = setup(t)
  const { applyChatEvent } = modules.loadShared('chat-work')
  const chat = service.store.create(version, 'openai', document.path)
  const selection = { ...sources[0], id: 'selection', kind: 'text' }
  const first = { ...userMessage('Original'), attachments: [selection] }
  chat.messages = [
    first,
    { ...userMessage('Old answer'), role: 'assistant' },
    userMessage('Later question'),
    { ...userMessage('Later answer'), role: 'assistant' }
  ]
  service.store.save(chat)
  let rendered = chat.messages
  const calls = []
  service.providers.generate = async (params) => {
    calls.push(params)
    if (params.instructions.startsWith('Write ONLY')) return emitSearchPlan(params)
    params.onUpdate({ type: 'delta', text: 'Replacement [[p1s1]]' })
  }
  await service.send(
    request(chat, { newConversation: undefined, editMessageId: first.id, text: 'Edited question' }),
    (event) => {
      rendered = applyChatEvent(rendered, event)
    }
  )
  const saved = service.store.get(chat.id)
  assert.deepEqual(rendered, saved.messages)
  assert.equal(saved.messages.length, 2)
  assert.equal(saved.messages[0].id, first.id)
  assert.equal(saved.messages[0].text, 'Edited question')
  assert.deepEqual(saved.messages[0].attachments, [selection])
  assert.equal(saved.messages[1].status, 'complete')
  assert.ok(calls.at(-1).turns.at(-1).text.includes(selection.text))
  assert.ok(!JSON.stringify(calls.at(-1).turns).includes('Later question'))
  for (const overrides of [
    { editMessageId: 'missing' },
    { editMessageId: saved.messages[1].id },
    { editMessageId: first.id, retryMessageId: saved.messages[1].id },
    { editMessageId: first.id, text: 'x'.repeat(16001) }
  ]) {
    await assert.rejects(
      service.send(request(chat, { newConversation: undefined, ...overrides }), () => {})
    )
    assert.deepEqual(service.store.get(chat.id), saved)
  }
})

test('fork copies only the selected assistant prefix and persists independently', async (t) => {
  const service = setup(t)
  const chat = service.store.create(version, 'openai', document.path)
  chat.title = 'Biology'
  chat.messages = [
    userMessage(),
    {
      ...userMessage('Answer [[p1s1]]'),
      role: 'assistant',
      sources,
      work: { parts: [{ type: 'reasoning', text: 'Evidence' }], durationMs: 1234 }
    },
    userMessage('Later')
  ]
  service.store.save(chat)
  const fork = service.fork(chat.id, chat.messages[1].id)
  assert.notEqual(fork.id, chat.id)
  assert.equal(fork.title, 'Biology (fork)')
  assert.equal(fork.documentVersion, chat.documentVersion)
  assert.equal(fork.provider, chat.provider)
  assert.deepEqual(
    fork.messages.map((message) => ({ ...message, id: 'normalized' })),
    chat.messages.slice(0, 2).map((message) => ({ ...message, id: 'normalized' }))
  )
  assert.ok(fork.messages.every((message, index) => message.id !== chat.messages[index].id))
  assert.deepEqual(service.store.get(fork.id), fork)
  assert.deepEqual(service.store.get(chat.id), chat)
  assert.throws(() => service.fork(chat.id, chat.messages[0].id), /assistant/)
  assert.throws(() => service.fork(chat.id, 'missing'), /assistant/)
  await service.remove(chat.id)
  assert.deepEqual(service.store.get(fork.id), fork)
})

test('edits and forks reject an active response without changing its saved prefix', async (t) => {
  const service = setup(t)
  const chat = service.store.create(version, 'openai', document.path)
  chat.messages = [userMessage(), { ...userMessage('Previous answer'), role: 'assistant' }]
  service.store.save(chat)
  let release
  const waiting = new Promise((resolve) => {
    release = resolve
  })
  service.providers.generate = async (params) => {
    await waiting
    if (params.instructions.startsWith('Write ONLY')) return emitSearchPlan(params)
    params.onUpdate({ type: 'delta', text: 'Complete' })
  }
  const pending = service.send(request(chat, { newConversation: undefined }), () => {})
  const saved = service.store.get(chat.id)
  try {
    assert.throws(() => service.fork(chat.id, chat.messages[1].id), /Wait/)
    await assert.rejects(
      service.send(
        request(chat, { newConversation: undefined, editMessageId: chat.messages[0].id }),
        () => {}
      ),
      /already running/
    )
    assert.deepEqual(service.store.get(chat.id), saved)
  } finally {
    release()
    await pending
  }
})

test('external attachments validate budgets and stay separate from PDF citations', async (t) => {
  const file = { id: 'a_external', kind: 'file', name: 'notes.txt', text: 'External evidence' }
  const image = {
    id: 'a_image',
    kind: 'file',
    name: 'figure.png',
    text: '',
    image: 'data:image/png;base64,YQ=='
  }
  validateAttachments([file, image])
  const selection = { ...sources[0], id: 'a_selection', kind: 'text', text: 'x'.repeat(16_000) }
  validateAttachments([{ ...file, text: 'x'.repeat(16_000) }, selection])
  assert.throws(
    () => validateAttachments([{ ...file, text: 'x'.repeat(16_001) }, selection]),
    /budget/
  )
  assert.throws(() => validateAttachments([{ ...file, name: '' }]), /Invalid attachment/)
  assert.throws(() => validateAttachments([{ ...file, text: '' }]), /Invalid attachment/)
  assert.throws(() => validateAttachments([{ ...file, text: 'x'.repeat(32_001) }]), /budget/)
  assert.throws(() => validateAttachments(Array(13).fill(file)), /at most 12/)
  assert.throws(
    () =>
      validateAttachments([{ ...image, image: 'data:image/png;base64,' + 'A'.repeat(9_000_000) }]),
    /budget/
  )
  const service = setup(t)
  const calls = []
  service.providers.generate = async (input) => {
    calls.push(input)
    if (input.instructions.startsWith('Write ONLY')) return emitSearchPlan(input)
    input.onUpdate({ type: 'delta', text: 'See notes.txt [[a_external]] and the PDF [[p1s1]].' })
  }
  const chat = service.store.create(version, 'openai', document.path)
  await service.send(request(chat, { text: '', attachments: [file, image] }), () => {})
  const saved = service.store.get(chat.id)
  assert.deepEqual(saved.messages[0].attachments, [file, image])
  assert.ok(saved.messages[1].text.includes('(reference unavailable)'))
  assert.ok(saved.messages[1].sources.every((source) => source.id !== file.id))
  const input = calls.at(-1).turns.at(-1)
  assert.ok(input.text.includes('External evidence'))
  assert.ok(input.text.includes('notes.txt'))
  assert.deepEqual(input.images, [image.image])
  const history = historyTurns(saved.messages)
  assert.ok(history[0].text.includes('notes.txt'))
  assert.deepEqual(history[0].sources, [])
  assert.deepEqual(history[0].images, [image.image])
})
