import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Crop,
  LoaderCircle,
  MessageSquarePlus,
  Plus,
  Settings,
  Square,
  TextSelect,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from '@/components/ui/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea
} from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
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
import { providerNames, providerSections } from './labels'
import { ProviderLogo } from './ProviderLogo'
import { ChatMessageView } from './ChatMessageView'
import './chat.css'

type Props = {
  tab: Tab
  active: boolean
  getViewer(id: string): PdfDocumentHandle | null
  onWidth(width: number): void
  onShowDocument(): void
  onSelectRegion(callback: (attachment: ChatAttachment) => void): void
  onCancelSelection(): void
}

export function ChatPanel({
  tab,
  active,
  getViewer,
  onWidth,
  onShowDocument,
  onSelectRegion,
  onCancelSelection
}: Props): React.JSX.Element {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [catalog, setCatalog] = useState<
    { provider: AiProvider; models: AiModel[]; error?: string }[]
  >([])
  const [modelChanging, setModelChanging] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [modelsLoading, setModelsLoading] = useState(false)
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
  const selectedTextRef = useRef<ChatAttachment[]>([])
  const sourceRef = useRef(tab.source)
  const activeRef = useRef(active)
  const showError = (error: unknown): void =>
    setError(error instanceof Error ? error.message : String(error))
  useLayoutEffect(() => {
    conversationRef.current = conversation
    statusRef.current = status
    activeRef.current = active
  }, [conversation, status, active])
  const reloadList = useCallback(async (): Promise<void> => {
    const chats = await window.lepis.ai.conversations(tab.path)
    setConversations(chats)
    setConversation((current) => {
      const saved = chats.find((chat) => chat.id === current?.id)
      return current && saved ? { ...current, title: saved.title } : current
    })
  }, [tab.path])

  useEffect(() => {
    if (!active) return
    let alive = true
    void Promise.all([window.lepis.ai.status(), window.lepis.ai.conversations(tab.path)])
      .then(async ([value, chats]) => {
        if (!alive) return
        setStatus(value)
        onWidth(value.settings.panelWidth)
        if (value.connected.length === 0 || !value.settings.consent) setSettingsOpen(true)
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
  const models = catalog.find((group) => group.provider === provider)?.models ?? []
  const modelsError = catalog
    .filter((group) => group.error)
    .map((group) => `${providerNames[group.provider]}: ${group.error}`)
    .join(' · ')
  const connectedProviders = JSON.stringify(status?.connected ?? [])
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
    !modelChanging &&
    models.some((model) => model.id === selectedModel) &&
    !stale &&
    !busy &&
    !loginBusy
  )

  useEffect(() => {
    if (!active) return
    let alive = true
    const providers = JSON.parse(connectedProviders) as AiProvider[]
    void Promise.resolve()
      .then(async () => {
        if (!alive) return []
        setModelsLoading(true)
        setCatalog([])
        return Promise.all(
          providers.map(async (provider) => {
            try {
              const models = await window.lepis.ai.models(provider)
              return {
                provider,
                models,
                error: models.length ? undefined : 'No supported models are available.'
              }
            } catch (error) {
              return {
                provider,
                models: [],
                error: error instanceof Error ? error.message : String(error)
              }
            }
          })
        )
      })
      .then((groups) => {
        if (!alive) return
        setCatalog(groups)
        const current = statusRef.current
        if (!current) return
        const defaults: Partial<Record<AiProvider, string>> = {}
        for (const group of groups) {
          if (
            group.models.length &&
            !group.models.some((model) => model.id === current.settings.models[group.provider])
          ) {
            defaults[group.provider] = group.models[0].id
          }
        }
        const available = groups.find((group) => group.models.length)?.provider
        const provider =
          !conversationRef.current && !providers.includes(current.settings.provider) && available
            ? available
            : current.settings.provider
        if (Object.keys(defaults).length || provider !== current.settings.provider) {
          setStatus((value) =>
            value
              ? {
                  ...value,
                  settings: {
                    ...value.settings,
                    provider,
                    models: { ...value.settings.models, ...defaults }
                  }
                }
              : value
          )
          void window.lepis.ai.settings({ provider, models: defaults }).catch(showError)
        }
      })
      .finally(() => {
        if (alive) setModelsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [connectedProviders, active, status?.chatgptAccount, connectionRevision])

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
  const chooseModel = async (value: string): Promise<void> => {
    if (!status || busy || modelChanging || !value) return
    const group = catalog.find((group) =>
      group.models.some((model) => `${group.provider}:${model.id}` === value)
    )
    const model = group?.models.find((model) => `${group.provider}:${model.id}` === value)
    if (!group || !model || !status.connected.includes(group.provider)) return
    setModelChanging(true)
    try {
      await window.lepis.ai.settings({
        provider: group.provider,
        models: { [group.provider]: model.id }
      })
      if (conversation && conversation.provider !== group.provider) await newChat(group.provider)
      setStatus((current) =>
        current
          ? {
              ...current,
              settings: {
                ...current.settings,
                provider: group.provider,
                models: { ...current.settings.models, [group.provider]: model.id }
              }
            }
          : current
      )
      setError('')
    } catch (error) {
      showError(error)
    } finally {
      setModelChanging(false)
    }
  }
  const action = (text: string, whole = false): void => {
    setDraft(text)
    setSummarize(whole)
    composerRef.current?.focus()
  }
  const saveTitle = (): void => {
    if (!conversation || rename === null) return
    const title = rename.trim()
    const id = conversation.id
    setRename(null)
    if (!title || title === conversation.title) return
    void window.lepis.ai
      .renameConversation(id, title)
      .then(() => {
        setConversation((current) => (current?.id === id ? { ...current, title } : current))
        return reloadList()
      })
      .catch(showError)
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" aria-label="AI chat panel">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        {rename !== null ? (
          <Input
            autoFocus
            className="mr-auto h-8 min-w-36 max-w-[calc(100%-7rem)] text-sm font-semibold"
            style={{ width: `${Math.max(12, (rename?.length ?? 0) + 2)}ch` }}
            aria-label="Conversation title"
            value={rename}
            maxLength={120}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setRename(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setRename(null)
              }
            }}
          />
        ) : (
          <Button
            variant="ghost"
            className="mr-auto min-w-36 max-w-[calc(100%-7rem)] justify-start px-2 text-sm font-semibold"
            aria-label="Rename conversation"
            title={conversation ? 'Click to rename conversation' : undefined}
            disabled={!conversation || busy}
            onClick={() => setRename(conversation?.title ?? '')}
          >
            <span className="truncate">{conversation?.title ?? 'New chat'}</span>
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New chat"
              disabled={!document || busy || modelChanging}
              onClick={() => void newChat().catch(showError)}
            >
              <MessageSquarePlus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New chat</TooltipContent>
        </Tooltip>
        <Dialog open={settingsOpen && active} onOpenChange={setSettingsOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="AI settings" disabled={!status}>
                  <Settings />
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>AI settings</TooltipContent>
          </Tooltip>
          {status && (
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>AI settings</DialogTitle>
                <DialogDescription className="sr-only">Manage AI connections.</DialogDescription>
              </DialogHeader>
              <AiSettingsView
                status={status}
                onStatus={(value) => {
                  setStatus(value)
                  setConnectionRevision((revision) => revision + 1)
                }}
                onError={setSettingsError}
              />
              {settingsError && (
                <p role="alert" className="text-xs text-destructive">
                  {settingsError}
                </p>
              )}
              {modelsError && !modelsLoading && (
                <div className="flex flex-col items-end gap-2">
                  <p role="alert" className="w-full text-xs text-destructive">
                    {modelsError}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConnectionRevision((value) => value + 1)}
                  >
                    Retry loading models
                  </Button>
                </div>
              )}
            </DialogContent>
          )}
        </Dialog>
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
          <div className="space-y-2 border-b px-3 py-2">
            {conversations.length > 0 && (
              <div className="flex items-center gap-1">
                <Select
                  value={conversation?.id ?? ''}
                  disabled={busy || modelChanging}
                  onValueChange={(value) => {
                    if (!value || value === conversation?.id) return
                    const id = value
                    void window.lepis.ai
                      .conversation(id)
                      .then((chat) => {
                        conversationRef.current = chat
                        setConversation(chat)
                        setRename(null)
                        setDeleteConfirm(false)
                        setScrollPinned(true)
                      })
                      .catch(showError)
                  }}
                >
                  <SelectTrigger
                    aria-label="Conversation history"
                    size="sm"
                    className="min-w-0 flex-1"
                  >
                    <SelectValue placeholder="Conversation history" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {conversations.map((chat) => (
                      <SelectItem key={chat.id} value={chat.id}>
                        {chat.title} · {providerNames[chat.provider]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Delete conversation"
                      disabled={!conversation || busy}
                      onClick={() => setDeleteConfirm((value) => !value)}
                    >
                      <Trash2 />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete conversation</TooltipContent>
                </Tooltip>
              </div>
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <button aria-label="Dismiss chat error" onClick={() => setError('')}>
                    <X className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Dismiss chat error</TooltipContent>
              </Tooltip>
            </div>
          )}
          <div className="shrink-0 space-y-2 border-t p-3">
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
                      <Tooltip>
                        <TooltipTrigger asChild>
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
                        </TooltipTrigger>
                        <TooltipContent>{`Remove selection on page ${attachment.page}`}</TooltipContent>
                      </Tooltip>
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label="Cancel document summary"
                      onClick={() => setSummarize(false)}
                    >
                      <X className="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Cancel document summary</TooltipContent>
                </Tooltip>
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void send()
              }}
              className="w-full"
            >
              <InputGroup>
                <InputGroupTextarea
                  ref={composerRef}
                  aria-label="Message AI"
                  className="max-h-40 min-h-20 text-sm"
                  placeholder={
                    !connected ? 'Connect an AI service in settings' : 'Ask about this PDF…'
                  }
                  value={draft}
                  maxLength={16000}
                  disabled={busy || Boolean(loginBusy)}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault()
                      void send()
                    }
                  }}
                />
                <InputGroupAddon align="block-end">
                  <DropdownMenu
                    onOpenChange={(open) => {
                      if (open)
                        selectedTextRef.current = getViewer(tab.id)?.attachSelectedText() ?? []
                    }}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <InputGroupButton
                            size="icon-sm"
                            aria-label="Add attachment"
                            disabled={busy || stale || !document}
                            onMouseDown={(event) => event.preventDefault()}
                          >
                            <Plus />
                          </InputGroupButton>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent>Add attachment</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent
                      align="start"
                      side="top"
                      onCloseAutoFocus={(event) => event.preventDefault()}
                    >
                      <DropdownMenuItem
                        onSelect={() => {
                          onCancelSelection()
                          addAttachments(selectedTextRef.current)
                        }}
                      >
                        <TextSelect />
                        Attach text
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          onSelectRegion((attachment) => addAttachments([attachment]))
                        }
                      >
                        <Crop />
                        Attach selection
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Select
                    value={
                      connected && models.some((model) => model.id === selectedModel)
                        ? `${provider}:${selectedModel}`
                        : ''
                    }
                    disabled={
                      busy ||
                      modelChanging ||
                      modelsLoading ||
                      !catalog.some((group) => group.models.length)
                    }
                    onValueChange={(value) => void chooseModel(value)}
                  >
                    <SelectTrigger
                      aria-label="AI model"
                      size="sm"
                      className="min-w-24 max-w-[calc(100%-6rem)] border-0 bg-transparent px-2 shadow-none dark:bg-transparent"
                    >
                      <SelectValue
                        placeholder={modelsLoading ? 'Loading models…' : 'Choose model'}
                      />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {providerSections.map((section) => {
                        const groups = catalog.filter(
                          (group) =>
                            section.providers.includes(group.provider) && group.models.length
                        )
                        if (!groups.length) return null
                        return (
                          <SelectGroup key={section.id}>
                            <SelectLabel>{section.name}</SelectLabel>
                            {groups.map((group) => (
                              <div key={group.provider}>
                                {group.models.map((model) => (
                                  <SelectItem
                                    value={`${group.provider}:${model.id}`}
                                    key={model.id}
                                  >
                                    <ProviderLogo provider={group.provider} />
                                    {model.name}
                                  </SelectItem>
                                ))}
                              </div>
                            ))}
                          </SelectGroup>
                        )
                      })}
                    </SelectContent>
                  </Select>
                  {busy ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <InputGroupButton
                          type="button"
                          variant="default"
                          size="icon-sm"
                          className="ml-auto"
                          aria-label="Stop response"
                          onClick={() => {
                            if (requestRef.current) void window.lepis.ai.stop(requestRef.current)
                          }}
                        >
                          <Square />
                        </InputGroupButton>
                      </TooltipTrigger>
                      <TooltipContent>Stop response</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <InputGroupButton
                          type="submit"
                          variant="default"
                          size="icon-sm"
                          className="ml-auto"
                          aria-label="Send message"
                          disabled={!ready || (!draft.trim() && !attachments.length)}
                        >
                          <ArrowUp />
                        </InputGroupButton>
                      </TooltipTrigger>
                      <TooltipContent>Send message</TooltipContent>
                    </Tooltip>
                  )}
                </InputGroupAddon>
              </InputGroup>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
