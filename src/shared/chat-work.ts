import type { ChatEvent, ChatMessage, ChatWork } from './ai'

type WorkEvent = Extract<ChatEvent, { type: 'reasoning-delta' | 'tool' }>

/** Keeps reasoning segments and tool invocations in their original stream order. */
export function updateChatWork(work: ChatWork | undefined, event: WorkEvent): ChatWork {
  const parts = [...(work?.parts ?? [])]
  const last = parts.at(-1)
  if (event.type === 'tool') {
    const index = parts.findIndex((part) => part.type === 'tool' && part.tool.id === event.tool.id)
    const part = { type: 'tool' as const, tool: { ...event.tool } }
    if (index === -1) parts.push(part)
    else parts[index] = part
  } else {
    if (last?.type === 'reasoning')
      parts[parts.length - 1] = { ...last, text: last.text + event.text }
    else if (event.text) parts.push({ type: 'reasoning', text: event.text })
  }
  return { parts, durationMs: work?.durationMs ?? 0 }
}

/** Applies streamed message updates to a conversation. */
export function applyChatEvent(messages: ChatMessage[], event: ChatEvent): ChatMessage[] {
  if (event.type === 'message' || event.type === 'finished') {
    const index = messages.findIndex((message) => message.id === event.message.id)
    if (index === -1) return [...messages, event.message]
    return messages.with(index, event.message)
  }
  return messages.map((message) => {
    if (message.id !== event.messageId) return message
    return event.type === 'delta'
      ? { ...message, text: message.text + event.text }
      : { ...message, work: updateChatWork(message.work, event) }
  })
}
