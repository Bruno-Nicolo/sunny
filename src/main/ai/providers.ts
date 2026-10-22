import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import type { AiModel, AiProvider, DocumentSource } from '../../shared/ai'
import { ChatgptAuth } from './chatgpt-auth'
import { CredentialStore } from './credentials'

export type ModelTurn = {
  role: 'user' | 'assistant'
  text: string
  images?: string[]
  sources?: DocumentSource[]
}
export type GenerateRequest = {
  provider: AiProvider
  model: string
  instructions: string
  turns: ModelTurn[]
  signal: AbortSignal
  onText(text: string): void
  onReasoning?(text: string): void
}

export class AiProviders {
  private anthropicOutputLimits = new Map<string, number>()
  private anthropicThinking = new Map<string, Anthropic.ThinkingConfigParam>()
  private googleThinking = new Set<string>()
  private openrouterThinking = new Set<string>()
  constructor(
    private credentials: CredentialStore,
    private chatgpt: ChatgptAuth
  ) {}
  private async key(provider: AiProvider, signal?: AbortSignal): Promise<string> {
    if (provider === 'chatgpt') return this.chatgpt.token(signal)
    const key = (await this.credentials.load()).keys[provider]
    if (!key) throw new Error(`Configure your ${provider} API key first.`)
    return key
  }
  async models(provider: AiProvider): Promise<AiModel[]> {
    const key = await this.key(provider)
    if (provider === 'chatgpt') {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(30_000)
      })
      if (!response.ok)
        throw new Error(
          `ChatGPT model catalog is unavailable (${response.status}). Check your account's plan usage permissions.`
        )
      const body = (await response.json()) as {
        models: { slug: string; display_name: string; visibility: string }[]
      }
      return body.models
        .filter((model) => model.visibility === 'list')
        .map((model) => ({ id: model.slug, name: model.display_name }))
    }
    if (provider === 'anthropic') {
      const result: AiModel[] = []
      for await (const model of new Anthropic({
        apiKey: key,
        maxRetries: 0,
        timeout: 30_000
      }).models.list()) {
        if (model.lifecycle !== 'active' || model.capabilities?.image_input.supported === false)
          continue
        if (model.max_tokens !== null) this.anthropicOutputLimits.set(model.id, model.max_tokens)
        const thinking = model.capabilities?.thinking
        if (thinking?.types.adaptive.supported)
          this.anthropicThinking.set(model.id, { type: 'adaptive', display: 'summarized' })
        else if (thinking?.types.enabled.supported)
          this.anthropicThinking.set(model.id, {
            type: 'enabled',
            budget_tokens: 2048,
            display: 'summarized'
          })
        result.push({ id: model.id, name: model.display_name })
      }
      return result
    }
    if (provider === 'google') {
      const models = await new GoogleGenAI({ apiKey: key }).models.list()
      const result: AiModel[] = []
      for await (const model of models) {
        if (model.name && model.supportedActions?.includes('generateContent')) {
          const id = model.name.replace(/^models\//, '')
          if (model.thinking) this.googleThinking.add(id)
          result.push({
            id,
            name: model.displayName ?? model.name
          })
        }
      }
      return result
    }
    if (provider === 'openrouter') {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(30_000)
      })
      if (!response.ok)
        throw new Error(`OpenRouter model catalog is unavailable (${response.status}).`)
      const body = (await response.json()) as {
        data: {
          id: string
          name: string
          architecture: { input_modalities: string[] }
          supported_parameters?: string[]
        }[]
      }
      for (const model of body.data)
        if (model.supported_parameters?.includes('reasoning')) this.openrouterThinking.add(model.id)
      return body.data
        .filter(
          (model) =>
            model.architecture.input_modalities.includes('text') &&
            model.architecture.input_modalities.includes('image')
        )
        .map((model) => ({ id: model.id, name: model.name }))
    }
    const models = await new OpenAI({ apiKey: key, maxRetries: 0, timeout: 30_000 }).models.list()
    return models.data
      .filter(
        (model) =>
          /^(gpt-(?:4o|4\.1|[5-9])|o[3-9](?:-|$)|chatgpt-)/.test(model.id) &&
          !/audio|realtime|transcribe|tts|image|codex/.test(model.id)
      )
      .map((model) => ({ id: model.id, name: model.id }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async generate(request: GenerateRequest): Promise<string> {
    const { provider, model, instructions, turns, signal, onText, onReasoning } = request
    signal.throwIfAborted()
    const key = await this.key(provider, signal)
    signal.throwIfAborted()
    let text = ''
    const emit = (delta: string): void => {
      text += delta
      onText(delta)
    }
    if (provider === 'chatgpt' || provider === 'openai') {
      const client = new OpenAI({ apiKey: key, maxRetries: 0, timeout: 120_000 })
      const stream = await client.responses.create(
        {
          model,
          instructions,
          store: false,
          stream: true,
          ...(onReasoning &&
          /^(?:o[3-9](?:-|$)|gpt-[5-9](?:[.-]|$))/.test(model) &&
          !model.includes('chat')
            ? { reasoning: { summary: 'auto' as const } }
            : {}),
          input: turns.map((turn) => ({
            role: turn.role,
            content:
              turn.role === 'assistant'
                ? turn.text
                : [
                    { type: 'input_text' as const, text: turn.text },
                    ...(turn.images ?? []).map((image) => ({
                      type: 'input_image' as const,
                      image_url: image,
                      detail: 'auto' as const
                    }))
                  ]
          }))
        },
        { signal }
      )
      let complete = false
      let reasoningPart: string | undefined
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') emit(event.delta)
        if (event.type === 'response.reasoning_summary_text.delta') {
          const part = `${event.item_id}:${event.summary_index}`
          if (reasoningPart && reasoningPart !== part) onReasoning?.('\n\n')
          reasoningPart = part
          onReasoning?.(event.delta)
        }
        if (event.type === 'response.completed') complete = true
        if (event.type === 'response.failed')
          throw new Error(
            event.response.error?.message ??
              'The AI request failed. Check account usage and permissions.'
          )
        if (event.type === 'response.incomplete')
          throw new Error('The AI response is incomplete. Try a smaller request.')
        if (event.type === 'error') throw new Error(event.message)
      }
      if (!complete) throw new Error('The AI connection ended before completion.')
    } else if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 120_000 })
      const thinking = onReasoning ? this.anthropicThinking.get(model) : undefined
      const stream = client.messages.stream(
        {
          model,
          system: instructions,
          max_tokens: Math.min(8192, this.anthropicOutputLimits.get(model) ?? 8192),
          ...(thinking ? { thinking } : {}),
          messages: turns.map((turn) => ({
            role: turn.role,
            content: [
              { type: 'text' as const, text: turn.text || ' ' },
              ...(turn.images ?? []).map((image) => ({
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'image/png' as const,
                  data: image.split(',')[1]
                }
              }))
            ]
          }))
        },
        { signal }
      )
      let reasoningBlock = false
      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'thinking') {
          if (reasoningBlock) onReasoning?.('\n\n')
          reasoningBlock = true
        }
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') emit(event.delta.text)
          if (event.delta.type === 'thinking_delta') onReasoning?.(event.delta.thinking)
        }
      }
      const final = await stream.finalMessage()
      if (final.stop_reason !== 'end_turn')
        throw new Error(`The AI response stopped before completion (${final.stop_reason}).`)
    } else if (provider === 'google') {
      const stream = await new GoogleGenAI({ apiKey: key }).models.generateContentStream({
        model,
        config: {
          systemInstruction: instructions,
          abortSignal: signal,
          ...(onReasoning && this.googleThinking.has(model)
            ? { thinkingConfig: { includeThoughts: true } }
            : {})
        },
        contents: turns.map((turn) => ({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [
            { text: turn.text || ' ' },
            ...(turn.images ?? []).map((image) => ({
              inlineData: { mimeType: 'image/png', data: image.split(',')[1] }
            }))
          ]
        }))
      })
      let finish: string | undefined
      for await (const chunk of stream) {
        signal.throwIfAborted()
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (!part.text) continue
          if (part.thought) onReasoning?.(part.text)
          else emit(part.text)
        }
        finish = chunk.candidates?.[0]?.finishReason ?? finish
      }
      if (finish !== 'STOP')
        throw new Error(`The AI response did not complete (${finish ?? 'connection closed'}).`)
    } else {
      const client = new OpenAI({
        apiKey: key,
        baseURL: 'https://openrouter.ai/api/v1',
        maxRetries: 0,
        timeout: 120_000
      })
      const stream = await client.chat.completions.create(
        {
          model,
          stream: true,
          ...(onReasoning && this.openrouterThinking.has(model)
            ? { reasoning: { enabled: true, exclude: false } }
            : {}),
          messages: [
            { role: 'system', content: instructions },
            ...turns.map((turn) =>
              turn.role === 'assistant'
                ? { role: 'assistant' as const, content: turn.text }
                : {
                    role: 'user' as const,
                    content: [
                      { type: 'text' as const, text: turn.text },
                      ...(turn.images ?? []).map((image) => ({
                        type: 'image_url' as const,
                        image_url: { url: image }
                      }))
                    ]
                  }
            )
          ]
        },
        { signal }
      )
      let finish: string | null = null
      for await (const chunk of stream) {
        if ('error' in chunk) throw new Error('OpenRouter reported an error during the response.')
        if (chunk.choices[0]?.delta.content) emit(chunk.choices[0].delta.content)
        const delta = chunk.choices[0]?.delta
        if (delta && 'reasoning' in delta && typeof delta.reasoning === 'string')
          onReasoning?.(delta.reasoning)
        finish = chunk.choices[0]?.finish_reason ?? finish
      }
      if (finish !== 'stop')
        throw new Error(`The AI response did not complete (${finish ?? 'connection closed'}).`)
    }
    signal.throwIfAborted()
    if (!text.trim()) throw new Error('The model returned an empty response.')
    return text
  }
}
