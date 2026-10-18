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
const { validateAttachments, validatedAnswer, historyTurns, parseSearchPlan } =
  modules.load('context')
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
const document = { version, path: '/test/biology.pdf', name: 'biology.pdf', pages: 2, sources }

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
function request(chat, overrides = {}) {
  return {
    requestId: crypto.randomUUID(),
    conversationId: chat.id,
    model: 'test-model',
    text: 'Explain photosynthesis',
    attachments: [],
    summarize: false,
    ...overrides
  }
}

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
    if (request.instructions.startsWith('Write ONLY'))
      return JSON.stringify({ scope: 'passages', queries: ['photosynthesis', 'chlorophyll'] })
    request.onText('Light becomes energy [[p1s1]]. ')
    request.onText('Unsupported [[invented]].')
    return 'ignored: streaming is authoritative'
  }
  const chat = service.store.create(version, 'openai', document.path)
  const attachment = { ...sources[0], id: 'a_text', kind: 'text' }
  const events = []
  await service.send(request(chat, { attachments: [attachment] }), (event) =>
    events.push(structuredClone(event))
  )
  const saved = service.store.get(chat.id)
  assert.equal(saved.messages.length, 2)
  assert.deepEqual(saved.messages[0].attachments, [attachment])
  assert.equal(saved.messages[1].status, 'complete')
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
    return ''
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
  assert.equal(service.store.get(chat.id).messages.length, 0)
})

test('stop stores an interrupted answer and retry replaces it without duplicating the user', async (t) => {
  const service = setup(t)
  const chat = service.store.create(version, 'openai', document.path)
  const sending = request(chat)
  service.providers.generate = async (params) => {
    if (params.instructions.startsWith('Write ONLY'))
      return JSON.stringify({ scope: 'passages', queries: ['photosynthesis'] })
    params.onText('Partial [[p1s1]]')
    service.stop(sending.requestId)
    params.signal.throwIfAborted()
    return ''
  }
  await service.send(sending, () => {})
  let saved = service.store.get(chat.id)
  assert.equal(saved.messages.at(-1).status, 'stopped')
  const retryMessageId = saved.messages.at(-1).id
  service.providers.generate = async (params) => {
    if (params.instructions.startsWith('Write ONLY'))
      return JSON.stringify({ scope: 'passages', queries: ['photosynthesis'] })
    params.onText('Complete [[p1s1]]')
    return 'Complete [[p1s1]]'
  }
  await service.send(request(chat, { retryMessageId }), () => {})
  saved = service.store.get(chat.id)
  assert.equal(saved.messages.length, 2)
  assert.equal(saved.messages.at(-1).status, 'complete')
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
      return 'Section summary [[p1s1]]'
    }
    if (fail) throw new Error('test interruption')
    params.onText('Full synthesis [[p1s1]]')
    return 'Full synthesis [[p1s1]]'
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
  store.index(document)
  const chat = store.create(version, 'chatgpt', document.path)
  chat.messages.push({
    id: 'answer',
    role: 'assistant',
    text: 'Partial',
    attachments: [],
    sources: [],
    status: 'streaming',
    createdAt: 1,
    model: 'test'
  })
  store.save(chat)
  store.close()
  store = new ChatStore(directory)
  assert.equal(store.get(chat.id).messages[0].status, 'stopped')
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

test('independent preference updates preserve panel width and per-provider model choices', (t) => {
  const service = setup(t)
  service.settings({ panelWidth: 460 })
  service.settings({ models: { openai: 'first-model' } })
  service.settings({ provider: 'google', models: { google: 'second-model' } })
  const settings = service.store.settings()
  assert.equal(settings.panelWidth, 460)
  assert.equal(settings.models.openai, 'first-model')
  assert.equal(settings.models.google, 'second-model')
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
    const body = JSON.parse(options.body)
    calls.push({ url, body })
    if (url.endsWith('/responses'))
      return sse([
        { type: 'response.output_text.delta', delta: 'Answer' },
        { type: incomplete ? 'response.incomplete' : 'response.completed', response: {} }
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
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Answer' } },
        { type: 'content_block_stop', index: 0 },
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
              content: { role: 'model', parts: [{ text: 'Answer' }] },
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
          choices: [{ index: 0, delta: { content: 'Answer' }, finish_reason: null }]
        },
        {
          id: 'test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'test',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        }
      ])
    throw new Error(`Unexpected endpoint ${url}`)
  }
  for (const provider of ['chatgpt', 'openai', 'anthropic', 'google', 'openrouter']) {
    let streamed = ''
    const result = await adapters.generate({
      provider,
      model: 'test-model',
      instructions: 'Use citations',
      turns: [{ role: 'user', text: 'Explain', images: ['data:image/png;base64,AAAA'] }],
      signal: new AbortController().signal,
      onText: (text) => {
        streamed += text
      }
    })
    assert.equal(result, 'Answer', provider)
    assert.equal(streamed, 'Answer', provider)
  }
  for (const call of calls.slice(0, 2)) {
    assert.equal(call.url, 'https://api.openai.com/v1/responses')
    assert.equal(call.body.store, false)
    assert.equal(call.body.stream, true)
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
  assert.equal(calls[3].body.contents[0].parts[1].inlineData.mimeType, 'image/png')
  assert.equal(calls[4].body.messages[1].content[1].image_url.url, 'data:image/png;base64,AAAA')
  incomplete = true
  await assert.rejects(
    adapters.generate({
      provider: 'chatgpt',
      model: 'test',
      instructions: '',
      turns: [{ role: 'user', text: 'Question' }],
      signal: new AbortController().signal,
      onText: () => {}
    }),
    /incomplete/
  )
})
