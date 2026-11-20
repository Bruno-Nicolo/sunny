import { randomUUID } from 'node:crypto'
import type Anthropic from '@anthropic-ai/sdk'
import type { GenerateContentResponse } from '@google/genai'
import type OpenAI from 'openai'
import type { ChatToolCall, ChatUpdate } from '../../shared/ai'

type StreamOutput = {
  emitText(delta: string): void
  emitReasoning(delta: string, part?: string | number): void
  onUpdate(update: ChatUpdate): void
}

type OpenRouterReasoningDetail =
  | { type: 'reasoning.summary'; summary?: string | null }
  | { type: 'reasoning.text'; text?: string | null }
  | { type: 'reasoning.encrypted' }

type OpenRouterDelta = OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
  reasoning?: string | null
  reasoning_details?: OpenRouterReasoningDetail[] | null
}

function openaiTool(
  item: OpenAI.Responses.ResponseOutputItem,
  done: boolean
): ChatToolCall | undefined {
  if (item.type === 'function_call' || item.type === 'custom_tool_call')
    return {
      id: item.call_id,
      name: item.name,
      input: item.type === 'function_call' ? item.arguments : item.input,
      status:
        item.type === 'function_call' && item.status === 'incomplete'
          ? 'stopped'
          : done
            ? 'requested'
            : 'running'
    }
  if (
    item.type !== 'web_search_call' &&
    item.type !== 'file_search_call' &&
    item.type !== 'code_interpreter_call'
  )
    return
  const status = item.status
  return {
    id: item.id,
    name: item.type.slice(0, -'_call'.length),
    input:
      item.type === 'web_search_call'
        ? { action: item.action }
        : item.type === 'file_search_call'
          ? { queries: item.queries }
          : (item.code ?? ''),
    status:
      status === 'completed'
        ? 'complete'
        : status === 'failed'
          ? 'error'
          : done
            ? 'stopped'
            : 'running'
  }
}

export async function openaiStream(
  stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
  { emitText, emitReasoning, onUpdate }: StreamOutput
): Promise<void> {
  let refusal = ''
  const commentaryItems = new Set<string>()
  const summaryLengths = new Map<string, number>()
  const emitSummary = (itemId: string, index: number, text: string, final = false): void => {
    const part = `${itemId}:${index}`
    const consumed = summaryLengths.get(part) ?? 0
    const delta = final ? text.slice(consumed) : text
    if (!delta) return
    summaryLengths.set(part, consumed + delta.length)
    emitReasoning(delta, part)
  }
  const emitItemSummary = (item: OpenAI.Responses.ResponseReasoningItem): void => {
    item.summary.forEach((part, index) => emitSummary(item.id, index, part.text, true))
  }
  for await (const event of stream) {
    switch (event.type) {
      case 'response.output_item.added':
      case 'response.output_item.done': {
        const done = event.type === 'response.output_item.done'
        const item = event.item
        if (!done && item.type === 'message' && item.phase === 'commentary')
          commentaryItems.add(item.id)
        if (done && item.type === 'reasoning') emitItemSummary(item)
        const tool = openaiTool(item, done)
        if (tool) onUpdate({ type: 'tool', tool })
        break
      }
      case 'response.output_text.delta':
        if (commentaryItems.has(event.item_id))
          onUpdate({ type: 'commentary-delta', id: event.item_id, text: event.delta })
        else emitText(event.delta)
        break
      case 'response.reasoning_summary_text.delta':
        emitSummary(event.item_id, event.summary_index, event.delta)
        break
      case 'response.reasoning_summary_text.done':
        emitSummary(event.item_id, event.summary_index, event.text, true)
        break
      case 'response.reasoning_summary_part.done':
        emitSummary(event.item_id, event.summary_index, event.part.text, true)
        break
      case 'response.refusal.delta':
        refusal += event.delta
        break
      case 'response.refusal.done':
        refusal = event.refusal
        break
      case 'response.completed':
      case 'response.incomplete':
        for (const item of event.response.output ?? [])
          if (item.type === 'reasoning') emitItemSummary(item)
        if (event.type === 'response.incomplete')
          throw new Error('The AI response is incomplete. Try a smaller request.')
        if (refusal) throw new Error(refusal)
        return
      case 'response.failed':
        throw new Error(
          event.response.error?.message ??
            'The AI request failed. Check account usage and permissions.'
        )
      case 'error':
        throw new Error(event.message)
    }
  }
  throw new Error('The AI connection ended before completion.')
}

export async function anthropicStream(
  stream: ReturnType<Anthropic['messages']['stream']>,
  { emitText, emitReasoning, onUpdate }: StreamOutput
): Promise<void> {
  const tools = new Map<string, ChatToolCall>()
  const updateTool = (tool: ChatToolCall): void => {
    tools.set(tool.id, tool)
    onUpdate({ type: 'tool', tool })
  }
  for await (const event of stream) {
    if (event.type === 'content_block_start') {
      const block = event.content_block
      if (block.type === 'thinking') emitReasoning(block.thinking, event.index)
      if (block.type === 'text') emitText(block.text)
      if (block.type === 'tool_use' || block.type === 'server_tool_use')
        updateTool({ id: block.id, name: block.name, input: {}, status: 'running' })
      if ('tool_use_id' in block) {
        const tool = tools.get(block.tool_use_id)
        if (tool) {
          const result = block.content
          const failed = !Array.isArray(result) && result.type.endsWith('_error')
          updateTool({ ...tool, status: failed ? 'error' : 'complete' })
        }
      }
    }
    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') emitText(event.delta.text)
      if (event.delta.type === 'thinking_delta') emitReasoning(event.delta.thinking, event.index)
    }
  }
  const final = await stream.finalMessage()
  for (const block of final.content) {
    if (block.type !== 'tool_use' && block.type !== 'server_tool_use') continue
    const tool = tools.get(block.id)
    if (!tool) continue
    updateTool({
      ...tool,
      input: JSON.stringify(block.input, null, 2),
      status: block.type === 'tool_use' ? 'requested' : tool.status
    })
  }
  if (final.stop_reason === 'refusal')
    throw new Error(final.stop_details?.explanation ?? 'The model declined this request.')
  if (final.stop_reason !== 'end_turn')
    throw new Error(`The AI response stopped before completion (${final.stop_reason}).`)
}

export async function googleStream(
  stream: AsyncIterable<GenerateContentResponse>,
  { emitText, emitReasoning, onUpdate }: StreamOutput,
  signal: AbortSignal
): Promise<void> {
  let finish: string | undefined
  let finishMessage: string | undefined
  for await (const chunk of stream) {
    signal.throwIfAborted()
    const candidate = chunk.candidates?.[0]
    for (const part of candidate?.content?.parts ?? []) {
      if (part.functionCall?.name) {
        const { id, name, args } = part.functionCall
        onUpdate({
          type: 'tool',
          tool: { id: id ?? randomUUID(), name, input: args ?? {}, status: 'requested' }
        })
      }
      if (!part.text) continue
      if (part.thought) emitReasoning(part.text)
      else emitText(part.text)
    }
    finish = candidate?.finishReason ?? finish
    finishMessage = candidate?.finishMessage ?? finishMessage
    if (chunk.promptFeedback?.blockReason)
      throw new Error(
        chunk.promptFeedback.blockReasonMessage ??
          `Gemini blocked the request (${chunk.promptFeedback.blockReason}).`
      )
  }
  if (finish !== 'STOP')
    throw new Error(
      finishMessage ?? `The AI response did not complete (${finish ?? 'connection closed'}).`
    )
}

export async function openrouterStream(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  { emitText, emitReasoning, onUpdate }: StreamOutput
): Promise<void> {
  let refusal = ''
  let finish: string | null = null
  const tools = new Map<number, ChatToolCall & { input: string }>()
  for await (const chunk of stream) {
    if ('error' in chunk) {
      const error = chunk.error
      throw new Error(
        error &&
          typeof error === 'object' &&
          'message' in error &&
          typeof error.message === 'string'
          ? error.message
          : 'OpenRouter reported an error during the response.'
      )
    }
    const choice = chunk.choices[0]
    const delta: OpenRouterDelta | undefined = choice?.delta
    if (delta) {
      for (const call of delta.tool_calls ?? []) {
        const input = call.function?.arguments ?? call.custom?.input ?? ''
        const name = call.function?.name ?? call.custom?.name
        const tool = tools.get(call.index)
        if (tool) {
          tool.input += input
          if (name) tool.name = name
        } else {
          const tool: ChatToolCall & { input: string } = {
            id: call.id ?? randomUUID(),
            name: name ?? 'Tool',
            input,
            status: 'running'
          }
          tools.set(call.index, tool)
          onUpdate({ type: 'tool', tool: { ...tool } })
        }
      }
      let reasoningText = ''
      if (delta.reasoning_details?.length) {
        for (const detail of delta.reasoning_details) {
          if (detail.type === 'reasoning.text') reasoningText += detail.text ?? ''
          if (detail.type === 'reasoning.summary') reasoningText += detail.summary ?? ''
        }
      } else {
        reasoningText = delta.reasoning ?? ''
      }
      emitReasoning(reasoningText)
      refusal += delta.refusal ?? ''
    }
    if (delta?.content) emitText(delta.content)
    finish = choice?.finish_reason ?? finish
  }
  const status = finish === 'tool_calls' || finish === 'stop' ? 'requested' : 'stopped'
  for (const tool of tools.values()) onUpdate({ type: 'tool', tool: { ...tool, status } })
  if (refusal) throw new Error(refusal)
  if (finish !== 'stop')
    throw new Error(`The AI response did not complete (${finish ?? 'connection closed'}).`)
}
