import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import {
  type AiModel,
  type AiProvider,
  type ChatUpdate,
  type DocumentSource,
  type ReasoningLevel
} from '../../shared/ai'
import { ChatgptAuth } from './chatgpt-auth'
import { CredentialStore } from './credentials'
import { anthropicStream, googleStream, openaiStream, openrouterStream } from './provider-streams'

function openaiReasoningLevels(model: string): ReasoningLevel[] {
  if (model.includes('chat') || !/^(?:o[3-9](?:-|$)|gpt-[5-9](?:[.-]|$))/.test(model)) return []
  if (/^gpt-[6-9]/.test(model)) return ['low', 'medium', 'high', 'xhigh', 'max']
  if (model.startsWith('o3-pro')) return ['high']
  if (model.includes('-pro')) return ['medium', 'high', 'xhigh']
  if (/^gpt-5(?:-|$)/.test(model)) return ['minimal', 'low', 'medium', 'high']
  if (/^gpt-5\.1(?:-|$)/.test(model)) return ['none', 'low', 'medium', 'high']
  if (model.startsWith('gpt-5.')) return ['none', 'low', 'medium', 'high', 'xhigh']
  return ['low', 'medium', 'high']
}
export type ModelTurn = {
  role: 'user' | 'assistant'
  text: string
  images?: string[]
  sources?: DocumentSource[]
}
export type GenerateRequest = {
  provider: AiProvider
  model: string
  reasoning?: ReasoningLevel
  instructions: string
  turns: ModelTurn[]
  signal: AbortSignal
  onUpdate(update: ChatUpdate): void
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
        .map((model) => ({
          id: model.slug,
          name: model.display_name,
          reasoningLevels: openaiReasoningLevels(model.slug)
        }))
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
        const effort = model.capabilities?.effort
        const levels = (['low', 'medium', 'high', 'xhigh', 'max'] as const).filter(
          (level) => effort?.[level]?.supported
        )
        result.push({ id: model.id, name: model.display_name, reasoningLevels: levels })
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
            name: model.displayName ?? model.name,
            reasoningLevels:
              model.thinking && /^gemini-3/.test(id)
                ? id.includes('flash')
                  ? ['low', 'medium', 'high']
                  : ['low', 'high']
                : []
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
        .map((model) => ({
          id: model.id,
          name: model.name,
          reasoningLevels: model.supported_parameters?.includes('reasoning')
            ? ['low', 'medium', 'high']
            : []
        }))
    }
    const models = await new OpenAI({ apiKey: key, maxRetries: 0, timeout: 30_000 }).models.list()
    return models.data
      .filter(
        (model) =>
          /^(gpt-(?:4o|4\.1|[5-9])|o[3-9](?:-|$)|chatgpt-)/.test(model.id) &&
          !/audio|realtime|transcribe|tts|image|codex/.test(model.id)
      )
      .map((model) => ({
        id: model.id,
        name: model.id,
        reasoningLevels: openaiReasoningLevels(model.id)
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async generate(request: GenerateRequest): Promise<void> {
    const { provider, model, reasoning, instructions, turns, signal, onUpdate } = request
    signal.throwIfAborted()
    const key = await this.key(provider, signal)
    signal.throwIfAborted()
    let hasAnswerText = false
    let reasoningPart: string | number | undefined
    const emitText = (delta: string): void => {
      if (!delta) return
      hasAnswerText ||= Boolean(delta.trim())
      onUpdate({ type: 'delta', text: delta })
    }
    const emitReasoning = (delta: string, part?: string | number): void => {
      if (!delta) return
      const separator = reasoningPart !== undefined && reasoningPart !== part ? '\n\n' : ''
      reasoningPart = part
      onUpdate({ type: 'reasoning-delta', text: separator + delta })
    }
    const output = { emitText, emitReasoning, onUpdate }
    if (provider === 'chatgpt' || provider === 'openai') {
      const client = new OpenAI({ apiKey: key, maxRetries: 0, timeout: 120_000 })
      const stream = await client.responses.create(
        {
          model,
          instructions,
          store: false,
          stream: true,
          reasoning: openaiReasoningLevels(model).length
            ? { summary: 'auto', effort: reasoning }
            : undefined,
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
      await openaiStream(stream, output)
    } else if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 120_000 })
      const thinking = this.anthropicThinking.get(model)
      const stream = client.messages.stream(
        {
          model,
          system: instructions,
          max_tokens: Math.min(8192, this.anthropicOutputLimits.get(model) ?? 8192),
          ...(thinking ? { thinking } : {}),
          ...(reasoning
            ? {
                output_config: { effort: reasoning as 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
              }
            : {}),
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
      await anthropicStream(stream, output)
    } else if (provider === 'google') {
      const stream = await new GoogleGenAI({ apiKey: key }).models.generateContentStream({
        model,
        config: {
          systemInstruction: instructions,
          abortSignal: signal,
          thinkingConfig: this.googleThinking.has(model)
            ? {
                includeThoughts: true,
                thinkingLevel: reasoning?.toUpperCase() as ThinkingLevel | undefined
              }
            : undefined
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
      await googleStream(stream, output, signal)
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
          ...(this.openrouterThinking.has(model)
            ? {
                reasoning: {
                  enabled: true,
                  exclude: false,
                  effort: reasoning
                }
              }
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
      await openrouterStream(stream, output)
    }
    signal.throwIfAborted()
    if (!hasAnswerText) throw new Error('The model returned an empty response.')
  }
}
