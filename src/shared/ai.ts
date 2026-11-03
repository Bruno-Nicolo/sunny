export const aiProviders = ['chatgpt', 'openai', 'anthropic', 'google', 'openrouter'] as const
export type AiProvider = (typeof aiProviders)[number]
export type ApiProvider = Exclude<AiProvider, 'chatgpt'>
export type PdfRect = [number, number, number, number]

export type DocumentSource = {
  id: string
  page: number
  text: string
  rects: PdfRect[]
}
export type ChatAttachment =
  | (DocumentSource & { kind: 'text' | 'region'; image?: string })
  | { id: string; kind: 'file'; name: string; text: string; image?: string }
export type ChatDocument = {
  version: string
  path: string
  name: string
  pages: number
  sources: DocumentSource[]
}
export type ChatToolCall = {
  id: string
  name: 'read_document' | 'search_document'
  input: Record<string, unknown>
  output?: string
  status: 'running' | 'complete' | 'error'
  error?: string
}
export type ChatWorkPart =
  { type: 'reasoning'; text: string } | { type: 'tool'; tool: ChatToolCall }
export type ChatWork = { parts: ChatWorkPart[]; durationMs: number }
export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  work?: ChatWork
  attachments: ChatAttachment[]
  sources: DocumentSource[]
  status: 'complete' | 'streaming' | 'stopped' | 'error'
  error?: string
  createdAt: number
  model: string
  summarize?: boolean
}
export type Conversation = {
  id: string
  documentVersion: string
  documentName: string
  documentPath: string
  provider: AiProvider
  title: string
  updatedAt: number
  messages: ChatMessage[]
}
export type ConversationSummary = Omit<Conversation, 'messages'>
export type AiSettings = {
  consent: boolean
  panelWidth: number
  chatFontSize: number
  provider: AiProvider
  models: Partial<Record<AiProvider, string>>
  reasoning: Record<string, ReasoningLevel>
}
export type AiStatus = {
  settings: AiSettings
  connected: AiProvider[]
  chatgptAccount?: string
  chatgptLogin: ChatgptLoginState
}
export type ChatgptLoginState = {
  phase:
    | 'idle'
    | 'preparing'
    | 'waiting-browser'
    | 'exchanging-code'
    | 'verifying-identity'
    | 'saving-session'
    | 'error'
  error?: string
}
export const reasoningLevels = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ReasoningLevel = (typeof reasoningLevels)[number]
export type AiModel = { id: string; name: string; reasoningLevels?: ReasoningLevel[] }

export type ChatSendRequest = {
  requestId: string
  conversationId: string
  newConversation?: { version: string; path: string; provider: AiProvider }
  model: string
  reasoning?: ReasoningLevel
  text: string
  attachments: ChatAttachment[]
  summarize: boolean
  editMessageId?: string
  retryMessageId?: string
}
export type ChatEvent = {
  requestId: string
  conversationId: string
} & (
  | { type: 'edited'; message: ChatMessage }
  | { type: 'message'; message: ChatMessage }
  | { type: 'delta'; messageId: string; text: string }
  | { type: 'reasoning-delta'; messageId: string; text: string }
  | { type: 'tool'; messageId: string; tool: ChatToolCall }
  | { type: 'finished'; message: ChatMessage }
)

export interface AiApi {
  status(): Promise<AiStatus>
  settings(settings: Partial<AiSettings>): Promise<void>
  connectChatgpt(): Promise<AiStatus>
  cancelLogin(): Promise<void>
  setKey(provider: ApiProvider, key: string): Promise<AiStatus>
  disconnect(provider: AiProvider): Promise<AiStatus>
  models(provider: AiProvider): Promise<AiModel[]>
  index(document: ChatDocument): Promise<void>
  conversations(path: string): Promise<ConversationSummary[]>
  conversation(id: string): Promise<Conversation>
  forkConversation(id: string, messageId: string): Promise<Conversation>
  renameConversation(id: string, title: string): Promise<void>
  deleteConversation(id: string): Promise<void>
  send(request: ChatSendRequest): Promise<void>
  stop(requestId: string): Promise<void>
  onEvent(callback: (event: ChatEvent) => void): () => void
  onLoginState(callback: (state: ChatgptLoginState) => void): () => void
}
