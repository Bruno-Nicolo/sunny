import type { ChatEvent, ChatMessage, ChatUpdate, ChatWork, ChatWorkPart } from './ai'

type ChatWorkUpdate = Exclude<ChatUpdate, { type: 'delta' }>

/** Appends new work entries and updates streamed entries in place. */
export function updateChatWork(
  work: ChatWork = { parts: [], durationMs: 0 },
  event: ChatWorkUpdate
): ChatWork {
  if (event.type !== 'tool' && !event.text) return work
  let index = -1
  let part: ChatWorkPart
  if (event.type === 'tool') {
    index = work.parts.findIndex((part) => part.type === 'tool' && part.tool.id === event.tool.id)
    part = { type: 'tool', tool: event.tool }
  } else if (event.type === 'commentary-delta') {
    index = work.parts.findIndex((part) => part.type === 'commentary' && part.id === event.id)
    const previous = work.parts[index]
    const text = previous?.type === 'commentary' ? previous.text + event.text : event.text
    part = { type: 'commentary', id: event.id, text }
  } else {
    const last = work.parts.at(-1)
    part = { type: 'reasoning', text: event.text }
    if (last?.type === 'reasoning') {
      index = work.parts.length - 1
      part.text = last.text + event.text
    }
  }
  return { ...work, parts: index === -1 ? [...work.parts, part] : work.parts.with(index, part) }
}

/** Closes tool entries that were still running when the response ended. */
export function stopChatWork(work: ChatWork): ChatWork {
  if (!work.parts.some((part) => part.type === 'tool' && part.tool.status === 'running'))
    return work
  return {
    ...work,
    parts: work.parts.map((part) =>
      part.type === 'tool' && part.tool.status === 'running'
        ? { ...part, tool: { ...part.tool, status: 'stopped' } }
        : part
    )
  }
}

/** Applies streamed message updates to a conversation. */
export function applyChatEvent(messages: ChatMessage[], event: ChatEvent): ChatMessage[] {
  const messageId = 'message' in event ? event.message.id : event.messageId
  const index = messages.findLastIndex((message) => message.id === messageId)
  if (event.type === 'edited') {
    return [...messages.slice(0, index < 0 ? messages.length : index), event.message]
  }
  if (event.type === 'message' || event.type === 'finished') {
    return index === -1 ? [...messages, event.message] : messages.with(index, event.message)
  }
  if (index === -1) return messages
  const message = messages[index]
  return messages.with(
    index,
    event.type === 'delta'
      ? { ...message, text: message.text + event.text }
      : { ...message, work: updateChatWork(message.work, event) }
  )
}
