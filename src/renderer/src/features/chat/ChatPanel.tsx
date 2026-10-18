import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Check,
  ChevronLeft,
  Crop,
  LoaderCircle,
  MessageSquarePlus,
  Pencil,
  Settings,
  Square,
  TextSelect,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Tab } from '@/features/documents/types'
import type { PdfDocumentHandle } from '@/features/pdf/types'
import type {
  AiModel,
  AiProvider,
  AiStatus,
  ChatAttachment,
  ChatDocument,
  ChatMessage,
  Conversation,
  ConversationSummary,
  DocumentSource
} from '../../../../shared/ai'
import { AiSettingsView } from './AiSettingsView'
import { providerNames } from './labels'
import { ChatMessageView } from './ChatMessageView'
import './chat.css'

type Props = {
  tab: Tab
  active: boolean
  getViewer(id: string): PdfDocumentHandle | null
  onWidth(width: number): void
  onClose(): void
  onShowDocument(): void
  onSelectRegion(callback: (attachment: ChatAttachment) => void): void
  onCancelSelection(): void
}

export function ChatPanel({
  tab,
  active,
  getViewer,
  onWidth,
  onClose,
  onShowDocument,
  onSelectRegion,
  onCancelSelection
}: Props): React.JSX.Element {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [models, setModels] = useState<AiModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [connectionRevision, setConnectionRevision] = useState(0)
  const [document, setDocument] = useState<ChatDocument | null>(null)
  const [indexProgress, setIndexProgress] = useState('')
  const [indexAttempt, setIndexAttempt] = useState(0)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [summarize, setSummarize] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [rename, setRename] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [scrollPinned, setScrollPinned] = useState(true)
  const messagesRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<string | null>(null)
  const conversationRef = useRef<Conversation | null>(null)
  const statusRef = useRef<AiStatus | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const sourceRef = useRef(tab.source)
  const activeRef = useRef(active)
  const showError = (error: unknown): void =>
    setError(error instanceof Error ? error.message : String(error))
  useLayoutEffect(() => {
    conversationRef.current = conversation
    statusRef.current = status
    activeRef.current = active
  }, [conversation, status, active])
  const reloadList = useCallback(
    async (): Promise<void> => setConversations(await window.lepis.ai.conversations(tab.path)),
    [tab.path]
  )

  useEffect(() => {
    if (!active) return
    let alive = true
    void Promise.all([window.lepis.ai.status(), window.lepis.ai.conversations(tab.path)])
      .then(async ([value, chats]) => {
        if (!alive) return
        setStatus(value)
        onWidth(value.settings.panelWidth)
        if (value.connected.length === 0) setSettingsOpen(true)
        setConversations(chats)
        if (chats[0]) {
          const latest = await window.lepis.ai.conversation(chats[0].id)
          if (alive && !conversationRef.current) setConversation(latest)
        }
      })
      .catch((error) => {
        if (alive) showError(error)
      })
    return () => {
      alive = false
    }
  }, [tab.path, onWidth, active])
  useEffect(
    () => () => {
      if (requestRef.current) void window.lepis.ai.stop(requestRef.current)
    },
    []
  )

  useEffect(
    () =>
      window.lepis.ai.onLoginState((login) => {
        setStatus((current) => (current ? { ...current, chatgptLogin: login } : current))
        if (login.phase === 'preparing') setError('')
        if (login.phase === 'error') setError(login.error ?? 'ChatGPT sign-in failed.')
        if (login.phase === 'idle' || login.phase === 'error') {
          void window.lepis.ai.status().then(setStatus).catch(showError)
          setConnectionRevision((revision) => revision + 1)
        }
      }),
    []
  )

  useEffect(() => {
    if (!active || !tab.view.pages) return
    const abort = new AbortController()
    let alive = true
    const viewer = getViewer(tab.id)
    void Promise.resolve()
      .then(async () => {
        if (!alive) return
        if (sourceRef.current !== tab.source) {
          sourceRef.current = tab.source
          setAttachments([])
          if (requestRef.current) void window.lepis.ai.stop(requestRef.current)
        }
        setDocument(null)
        setIndexProgress('Preparing document…')
        if (!viewer) throw new Error('Wait for the PDF to finish opening.')
        const indexed = await viewer.prepareChatDocument((page, pages) => {
          if (alive) setIndexProgress(`Preparing PDF locally · ${page}/${pages} pages`)
        }, abort.signal)
        if (!alive) return
        const value = { ...indexed, name: tab.name, path: tab.path }
        await window.lepis.ai.index(value)
        if (alive) {
          setDocument(value)
          setIndexProgress('')
        }
      })
      .catch((error) => {
        if (alive && !abort.signal.aborted) {
          showError(error)
          setIndexProgress('')
        }
      })
    return () => {
      alive = false
      abort.abort()
      viewer?.selectChatRegion(null)
    }
  }, [tab.id, tab.name, tab.path, tab.source, tab.view.pages, active, indexAttempt, getViewer])

  const provider = conversation?.provider ?? status?.settings.provider ?? 'chatgpt'
  const connected = status?.connected.includes(provider) ?? false
  const selectedModel = status?.settings.models[provider] ?? ''
  const stale = Boolean(
    document && conversation && conversation.documentVersion !== document.version
  )
  const busy =
    requestId !== null ||
    conversation?.messages.some((message) => message.status === 'streaming') === true
  const loginBusy = Boolean(status && !['idle', 'error'].includes(status.chatgptLogin.phase))
  const ready = Boolean(
    document &&
    connected &&
    status?.settings.consent &&
    selectedModel &&
    !modelsLoading &&
    models.some((model) => model.id === selectedModel) &&
    !stale &&
    !busy &&
    !loginBusy
  )

  useEffect(() => {
    if (!connected || !active) return
    let alive = true
    void Promise.resolve()
      .then(async () => {
        if (!alive) return []
        setModels([])
        setModelsLoading(true)
        setModelsError('')
        return window.lepis.ai.models(provider)
      })
      .then((value) => {
        if (!alive) return
        setModels(value)
        if (!value.length) {
          setModelsError('No supported models are available for this connection.')
          return
        }
        const current = statusRef.current!
        if (!value.some((model) => model.id === current.settings.models[provider])) {
          const next = {
            ...current,
            settings: {
              ...current.settings,
              models: { ...current.settings.models, [provider]: value[0].id }
            }
          }
          setStatus(next)
          void window.lepis.ai.settings({ models: { [provider]: value[0].id } }).catch(showError)
        }
      })
      .catch((error) => {
        if (alive) setModelsError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (alive) setModelsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [provider, connected, active, status?.chatgptAccount, connectionRevision])

  useEffect(
    () =>
      window.lepis.ai.onEvent((event) => {
        if (event.conversationId !== conversationRef.current?.id) return
        if (event.type !== 'finished') {
          setRequestId(event.requestId)
          requestRef.current = event.requestId
        }
        if (event.type === 'progress') {
          setProgress(event.text)
          setRequestId(event.requestId)
          requestRef.current = event.requestId
          return
        }
        if (event.type === 'delta') {
          setConversation((current) =>
            current
              ? {
                  ...current,
                  messages: current.messages.map((message) =>
                    message.id === event.messageId
                      ? { ...message, text: message.text + event.text }
                      : message
                  )
                }
              : current
          )
        } else {
          const message = event.message
          setConversation((current) =>
            current
              ? {
                  ...current,
                  messages: current.messages.some((item) => item.id === message.id)
                    ? current.messages.map((item) => (item.id === message.id ? message : item))
                    : [...current.messages, message]
                }
              : current
          )
          if (event.type === 'finished') {
            setRequestId(null)
            requestRef.current = null
            setProgress('')
            void reloadList().catch(showError)
          }
        }
      }),
    [reloadList]
  )

  useEffect(() => {
    if (scrollPinned) messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight })
  }, [conversation, progress, scrollPinned])

  const newChat = async (value: AiProvider = provider): Promise<Conversation | null> => {
    if (!document || busy) return null
    const chat = await window.lepis.ai.createConversation(document.version, value, tab.path)
    conversationRef.current = chat
    setConversation(chat)
    setRename(null)
    setDeleteConfirm(false)
    await reloadList()
    return chat
  }
  const addAttachments = (items: ChatAttachment[]): void => {
    if (!items.length) {
      setError('Select text in the PDF first.')
      return
    }
    setAttachments((current) => [...current, ...items])
    setError('')
    composerRef.current?.focus()
  }
  const send = async (retry?: ChatMessage): Promise<void> => {
    if (!ready || requestRef.current) return
    const id = crypto.randomUUID()
    requestRef.current = id
    setRequestId(id)
    setError('')
    setScrollPinned(true)
    try {
      const chat = conversation ?? (await newChat())
      if (!chat) return
      if (retry) setConversation({ ...chat, messages: chat.messages.slice(0, -1) })
      requestRef.current = id
      setRequestId(id)
      setProgress('Preparing request…')
      const pending = window.lepis.ai.send({
        requestId: id,
        conversationId: chat.id,
        model: selectedModel,
        text: draft,
        attachments,
        summarize,
        retryMessageId: retry?.id
      })
      // Keep the draft until the main process accepts and stores the user message.
      await pending
      if (!retry) {
        setDraft('')
        setAttachments([])
        setSummarize(false)
      }
    } catch (error) {
      showError(error)
      if (retry && conversation) {
        const latest = await window.lepis.ai.conversation(conversation.id)
        setConversation(latest)
      }
    } finally {
      setRequestId(null)
      requestRef.current = null
      setProgress('')
    }
  }
  const cite = (source: DocumentSource): void => {
    if (!document || stale) return
    onShowDocument()
    requestAnimationFrame(() => {
      if (activeRef.current) getViewer(tab.id)?.showCitation(source)
    })
  }
  const chooseProvider = async (value: AiProvider): Promise<void> => {
    if (!status || busy) return
    try {
      if (document && conversation?.provider !== value) await newChat(value)
      const next = { ...status, settings: { ...status.settings, provider: value } }
      await window.lepis.ai.settings({ provider: value })
      setStatus(next)
      setError('')
    } catch (error) {
      showError(error)
    }
  }
  const action = (text: string, whole = false): void => {
    setDraft(text)
    setSummarize(whole)
    composerRef.current?.focus()
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" aria-label="AI chat panel">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <span className="mr-auto text-sm font-semibold">AI chat</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Show PDF"
          title="Show PDF"
          onClick={onShowDocument}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New chat"
          disabled={!document || busy}
          onClick={() => void newChat().catch(showError)}
        >
          <MessageSquarePlus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="AI settings"
          aria-pressed={settingsOpen}
          onClick={() => setSettingsOpen((value) => !value)}
        >
          <Settings />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close AI chat" onClick={onClose}>
          <X />
        </Button>
      </div>
      {!status ? (
        <div className="space-y-3 p-4 text-sm">
          <p role={error ? 'alert' : 'status'}>{error || 'Loading AI settings…'}</p>
          {error && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setError('')
                void window.lepis.ai
                  .status()
                  .then((value) => {
                    setStatus(value)
                    onWidth(value.settings.panelWidth)
                    return reloadList()
                  })
                  .catch(showError)
              }}
            >
              Retry AI settings
            </Button>
          )}
        </div>
      ) : (
        <>
          {!status.settings.consent && (
            <div className="space-y-3 border-b p-4 text-sm">
              <p className="font-medium">Use AI with this app</p>
              <p className="text-muted-foreground">
                Document excerpts, selected images and needed conversation history will be sent to
                your chosen AI service. Chat history is stored on this computer. AI can make
                mistakes.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  const next = { ...status, settings: { ...status.settings, consent: true } }
                  void window.lepis.ai
                    .settings({ consent: true })
                    .then(() => {
                      setStatus(next)
                      setSettingsOpen(true)
                    })
                    .catch(showError)
                }}
              >
                Allow AI requests
              </Button>
            </div>
          )}
          {settingsOpen && status.settings.consent && (
            <div className="max-h-[45%] shrink-0 overflow-auto">
              <AiSettingsView
                status={status}
                onStatus={(value) => {
                  setStatus(value)
                  setConnectionRevision((revision) => revision + 1)
                }}
                onError={setError}
              />
            </div>
          )}
          <div className="space-y-2 border-b px-3 py-2">
            <div className="flex gap-2">
              <select
                aria-label="AI provider"
                className="chat-select min-w-0 flex-1"
                value={provider}
                disabled={busy}
                onChange={(event) => void chooseProvider(event.target.value as AiProvider)}
              >
                {Object.entries(providerNames).map(([id, label]) => (
                  <option value={id} key={id}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                aria-label="AI model"
                className="chat-select min-w-0 flex-1"
                value={selectedModel}
                disabled={busy || !connected || modelsLoading}
                onChange={(event) => {
                  const next = {
                    ...status,
                    settings: {
                      ...status.settings,
                      models: { ...status.settings.models, [provider]: event.target.value }
                    }
                  }
                  void window.lepis.ai
                    .settings({ models: { [provider]: event.target.value } })
                    .then(() => setStatus(next))
                    .catch(showError)
                }}
              >
                <option value="">
                  {connected && modelsLoading ? 'Loading models…' : 'Choose model'}
                </option>
                {connected &&
                  models.map((model) => (
                    <option value={model.id} key={model.id}>
                      {model.name}
                    </option>
                  ))}
              </select>
            </div>
            {provider === 'chatgpt' && connected && (
              <p className="text-[11px] text-muted-foreground">
                Using ChatGPT plan ·{' '}
                <a
                  className="underline"
                  href="https://chatgpt.com/settings/usage"
                  target="_blank"
                  rel="noreferrer"
                >
                  Manage usage
                </a>
              </p>
            )}
            {provider === 'openrouter' && (
              <p className="text-[11px] text-muted-foreground">
                OpenRouter routes requests to the selected model’s upstream provider.
              </p>
            )}
            {connected && !modelsLoading && !models.length && (
              <div className="space-y-1">
                {modelsError && (
                  <p role="alert" className="text-xs text-destructive">
                    {modelsError}
                  </p>
                )}
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setConnectionRevision((value) => value + 1)}
                >
                  Retry loading models
                </Button>
              </div>
            )}
            {conversations.length > 0 && (
              <div className="flex items-center gap-1">
                <select
                  aria-label="Conversation history"
                  className="chat-select min-w-0 flex-1"
                  value={conversation?.id ?? ''}
                  disabled={busy}
                  onChange={(event) => {
                    const id = event.target.value
                    void window.lepis.ai
                      .conversation(id)
                      .then((chat) => {
                        conversationRef.current = chat
                        setConversation(chat)
                        setDeleteConfirm(false)
                        setScrollPinned(true)
                      })
                      .catch(showError)
                  }}
                >
                  <option value="" disabled>
                    Conversation history
                  </option>
                  {conversations.map((chat) => (
                    <option key={chat.id} value={chat.id}>
                      {chat.title} · {providerNames[chat.provider]}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Rename conversation"
                  disabled={!conversation || busy}
                  onClick={() => setRename(conversation?.title ?? '')}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Delete conversation"
                  disabled={!conversation || busy}
                  onClick={() => setDeleteConfirm((value) => !value)}
                >
                  <Trash2 />
                </Button>
              </div>
            )}
            {rename !== null && (
              <form
                className="flex gap-1"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (conversation)
                    void window.lepis.ai
                      .renameConversation(conversation.id, rename)
                      .then(() => {
                        setConversation({ ...conversation, title: rename })
                        setRename(null)
                        return reloadList()
                      })
                      .catch(showError)
                }}
              >
                <input
                  className="chat-select min-w-0 flex-1"
                  aria-label="Conversation title"
                  value={rename}
                  onChange={(event) => setRename(event.target.value)}
                  maxLength={120}
                />
                <Button size="icon-xs" type="submit" aria-label="Save conversation title">
                  <Check />
                </Button>
              </form>
            )}
            {deleteConfirm && (
              <div className="flex items-center gap-2 text-xs">
                <span>Delete this chat and its selections?</span>
                <Button
                  size="xs"
                  variant="destructive"
                  onClick={() => {
                    if (conversation)
                      void window.lepis.ai
                        .deleteConversation(conversation.id)
                        .then(() => {
                          conversationRef.current = null
                          setConversation(null)
                          setDeleteConfirm(false)
                          return reloadList()
                        })
                        .catch(showError)
                  }}
                >
                  Delete
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setDeleteConfirm(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
          {indexProgress && (
            <p
              role="status"
              className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground"
            >
              <LoaderCircle className="size-3 animate-spin" />
              {indexProgress}
            </p>
          )}
          {stale && (
            <div className="border-b bg-muted px-3 py-2 text-xs">
              The PDF content changed. This conversation belongs to an older version; its citations
              are unavailable.
              <Button variant="link" size="xs" onClick={() => void newChat().catch(showError)}>
                Start new chat
              </Button>
            </div>
          )}
          <div
            ref={messagesRef}
            className="min-h-0 flex-1 overflow-auto p-4"
            onScroll={(event) => {
              const element = event.currentTarget
              setScrollPinned(element.scrollHeight - element.scrollTop - element.clientHeight < 80)
            }}
          >
            {!conversation?.messages.length && (
              <div className="space-y-3 py-6 text-sm text-muted-foreground">
                <p>
                  Ask about <span className="font-medium text-foreground">{tab.name}</span>. Answers
                  can cite passages you can open in the PDF.
                </p>
                <p>
                  Select text or draw a rectangle to include a specific passage, formula or figure.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!document || busy}
                  onClick={() =>
                    action(
                      'Summarize the entire document, covering its main arguments and conclusions.',
                      true
                    )
                  }
                >
                  Summarize document
                </Button>
              </div>
            )}
            {conversation?.messages.map((message, index) => (
              <ChatMessageView
                key={message.id}
                message={message}
                stale={stale || !document}
                retry={
                  !busy &&
                  !stale &&
                  index === conversation.messages.length - 1 &&
                  message.status !== 'streaming'
                }
                onCitation={cite}
                onRetry={() => void send(message)}
                onError={setError}
              />
            ))}
            {busy && (
              <p
                role="status"
                className="flex items-center gap-2 py-2 text-xs text-muted-foreground"
              >
                <LoaderCircle className="size-3 animate-spin" />
                {progress || 'Response in progress…'}
              </p>
            )}
          </div>
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 border-t px-3 py-2 text-xs text-destructive"
            >
              <span className="min-w-0 flex-1 break-words">{error}</span>
              {!document && !indexProgress && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setIndexAttempt((value) => value + 1)}
                >
                  Retry PDF
                </Button>
              )}
              <button aria-label="Dismiss chat error" onClick={() => setError('')}>
                <X className="size-3" />
              </button>
            </div>
          )}
          <div className="shrink-0 space-y-2 border-t p-3">
            <div className="flex flex-wrap gap-1">
              <Button
                variant="ghost"
                size="xs"
                disabled={busy || stale || !document}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onCancelSelection()
                  addAttachments(getViewer(tab.id)?.attachSelectedText() ?? [])
                }}
              >
                <TextSelect />
                Attach text
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={busy || stale || !document}
                onClick={() => onSelectRegion((attachment) => addAttachments([attachment]))}
              >
                <Crop />
                Select region
              </Button>
            </div>
            <Button
              variant="ghost"
              size="xs"
              disabled={!document || busy || stale}
              onClick={() =>
                action(
                  'Summarize the entire document, covering its main arguments and conclusions.',
                  true
                )
              }
            >
              Summarize PDF
            </Button>
            {attachments.length > 0 && (
              <>
                <div className="flex max-h-32 flex-wrap gap-2 overflow-auto">
                  {attachments.map((attachment) => (
                    <div
                      className="relative w-24 rounded-md border p-1.5 text-[11px]"
                      key={attachment.id}
                    >
                      <button
                        className="absolute -right-1 -top-1 rounded-full border bg-background p-0.5"
                        aria-label={`Remove selection on page ${attachment.page}`}
                        disabled={busy}
                        onClick={() =>
                          setAttachments((current) =>
                            current.filter((item) => item.id !== attachment.id)
                          )
                        }
                      >
                        <X className="size-3" />
                      </button>
                      {attachment.image ? (
                        <img
                          className="mb-1 h-12 w-full object-contain"
                          src={attachment.image}
                          alt={`Region on page ${attachment.page}`}
                        />
                      ) : (
                        <p className="mb-1 line-clamp-2" title={attachment.text}>
                          {attachment.text}
                        </p>
                      )}
                      Page {attachment.page}
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {[
                    ['Explain', 'Explain these selections.'],
                    ['Summarize', 'Summarize these selections.'],
                    [
                      'Translate',
                      'Translate these selections into the language I use in this conversation.'
                    ],
                    [
                      'Formula / figure',
                      'Explain the selected formula or figure, including its symbols and meaning.'
                    ]
                  ].map(([label, prompt]) => (
                    <Button
                      key={label}
                      variant="secondary"
                      size="xs"
                      disabled={busy}
                      onClick={() => action(prompt)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </>
            )}
            {summarize && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex-1">
                  Full document summary · may require multiple AI requests
                </span>
                <button aria-label="Cancel document summary" onClick={() => setSummarize(false)}>
                  <X className="size-3" />
                </button>
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void send()
              }}
              className="rounded-lg border bg-muted/20 p-2 focus-within:ring-1 focus-within:ring-ring"
            >
              <textarea
                ref={composerRef}
                aria-label="Message AI"
                className="max-h-40 min-h-20 w-full resize-y bg-transparent p-1 text-sm outline-none"
                placeholder={
                  !connected ? 'Connect an AI service in settings' : 'Ask about this PDF…'
                }
                value={draft}
                maxLength={16000}
                disabled={busy || Boolean(loginBusy)}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {attachments.length ? `${attachments.length} selections · ` : ''}PDF + model
                  knowledge
                </span>
                {busy ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    aria-label="Stop response"
                    onClick={() => {
                      if (requestRef.current) void window.lepis.ai.stop(requestRef.current)
                    }}
                  >
                    <Square />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon-sm"
                    aria-label="Send message"
                    disabled={!ready || (!draft.trim() && !attachments.length)}
                  >
                    <ArrowUp />
                  </Button>
                )}
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
