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
export type ChatAttachment = DocumentSource & {
  kind: 'text' | 'region'
  image?: string
}
export type ChatDocument = {
  version: string
  path: string
  name: string
  pages: number
  sources: DocumentSource[]
}
export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
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
  provider: AiProvider
  models: Partial<Record<AiProvider, string>>
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
export type AiModel = { id: string; name: string }
export type ChatSendRequest = {
  requestId: string
  conversationId: string
  model: string
  text: string
  attachments: ChatAttachment[]
  summarize: boolean
  retryMessageId?: string
}
export type ChatEvent = {
  requestId: string
  conversationId: string
} & (
  | { type: 'progress'; text: string }
  | { type: 'message'; message: ChatMessage }
  | { type: 'delta'; messageId: string; text: string }
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
  createConversation(version: string, provider: AiProvider, path: string): Promise<Conversation>
  renameConversation(id: string, title: string): Promise<void>
  deleteConversation(id: string): Promise<void>
  send(request: ChatSendRequest): Promise<void>
  stop(requestId: string): Promise<void>
  onEvent(callback: (event: ChatEvent) => void): () => void
  onLoginState(callback: (state: ChatgptLoginState) => void): () => void
}
