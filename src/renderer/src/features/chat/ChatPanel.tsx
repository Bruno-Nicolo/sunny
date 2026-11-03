import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import {
  ArrowUp,
  ChevronLeft,
  Crop,
  FilePlus,
  LoaderCircle,
  Paperclip,
  Plus,
  Settings,
  Square,
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
import { InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group'
import type { Tab } from '@/features/documents/types'
import type { PdfDocumentHandle } from '@/features/pdf/types'
import type {
  AiSettings,
  AiProvider,
  AiStatus,
  ChatAttachment,
  ChatDocument,
  ChatMessage,
  Conversation,
  ConversationSummary,
  DocumentSource
} from '../../../../shared/ai'
import type { ReasoningLevel } from '../../../../shared/ai'
import { ChatModelSelector, type ModelCatalog } from './ChatModelSelector'
import { AiSettingsView } from './AiSettingsView'
import { providerNames } from './labels'
import { ConversationHistory } from './ConversationHistory'
import { ChatMessageView } from './ChatMessageView'
import { MessageGroup } from '@/components/ui/message'
import { ChatActivity } from './ChatActivity'
import { applyChatEvent } from '../../../../shared/chat-work'
import { useAppShortcuts } from '@/features/shortcuts/useAppShortcuts'
import { readExternalAttachments, externalAttachmentAccept } from './externalAttachments'
import { ChatAttachmentPreview } from './ChatAttachmentPreview'
import { ChatComposerDropZone } from './ChatComposerDropZone'
import './chat.css'

type Props = {
  selectedAttachments: ChatAttachment[] | null
  onSelectionConsumed(): void
  tab: Tab
  active: boolean
  visible: boolean
  getViewer(id: string): PdfDocumentHandle | null
  onWidth(width: number): void
  onShowDocument(): void
  onSelectRegion(callback: (attachment: ChatAttachment) => void): void
}

export function ChatPanel({
  selectedAttachments,
  onSelectionConsumed,
  tab,
  active,
  visible,
  getViewer,
  onWidth,
  onShowDocument,
  onSelectRegion
}: Props): React.JSX.Element {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [catalog, setCatalog] = useState<ModelCatalog>([])
  const [modelChanging, setModelChanging] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [modelsLoading, setModelsLoading] = useState(false)
  const [connectionRevision, setConnectionRevision] = useState(0)
  const [document, setDocument] = useState<ChatDocument | null>(null)
  const [indexProgress, setIndexProgress] = useState('')
  const [indexAttempt, setIndexAttempt] = useState(0)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [previousSelection, setPreviousSelection] = useState<ChatAttachment[] | null>(null)
  if (selectedAttachments !== previousSelection) {
    setPreviousSelection(selectedAttachments)
    if (selectedAttachments) {
      setAttachments((current) => [...current, ...selectedAttachments])
      setHistoryOpen(false)
    }
  }
  const [summarize, setSummarize] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [forking, setForking] = useState(false)
  const forkingRef = useRef(false)
  const [error, setError] = useState('')
  const [rename, setRename] = useState<string | null>(null)
  const [scrollPinned, setScrollPinned] = useState(true)
  const messagesRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<string | null>(null)
  const conversationRef = useRef<Conversation | null>(null)
  const statusRef = useRef<AiStatus | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachingFiles, setAttachingFiles] = useState(false)
  const attachmentImportRef = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!selectedAttachments) return
    onSelectionConsumed()
  }, [selectedAttachments, onSelectionConsumed])
  const statusLoaded = Boolean(status)
  useEffect(() => {
    if (visible && statusLoaded && !historyOpen && !settingsOpen) {
      composerRef.current?.focus({ preventScroll: true })
    }
  }, [visible, statusLoaded, historyOpen, settingsOpen, selectedAttachments])
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
      .then(([value, chats]) => {
        if (!alive) return
        setStatus(value)
        onWidth(value.settings.panelWidth)
        if (value.connected.length === 0 || !value.settings.consent) setSettingsOpen(true)
        setConversations(chats)
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
      attachmentImportRef.current?.abort()
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
          attachmentImportRef.current?.abort()
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
  const model = models.find((model) => model.id === selectedModel)
  const levels = model?.reasoningLevels ?? []
  const reasoningKey = `${provider}:${selectedModel}`
  const savedReasoning = status?.settings.reasoning[reasoningKey]
  const selectedReasoning =
    savedReasoning && levels.includes(savedReasoning)
      ? savedReasoning
      : levels.includes('medium')
        ? 'medium'
        : levels[0]
  const modelsError = catalog
    .filter((group) => group.error)
    .map((group) => `${providerNames[group.provider]}: ${group.error}`)
    .join(' · ')
  const connectedProviders = JSON.stringify(status?.connected ?? [])
  const stale = Boolean(
    document && conversation && conversation.documentVersion !== document.version
  )
  const busy =
    forking ||
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
    model &&
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
        setConversation((current) =>
          current
            ? {
                ...current,
                title:
                  !current.messages.length &&
                  event.type === 'message' &&
                  event.message.role === 'user'
                    ? event.message.text.slice(0, 70)
                    : current.title,
                messages: applyChatEvent(current.messages, event)
              }
            : current
        )
        if (event.type === 'finished') {
          setRequestId(null)
          requestRef.current = null
          void reloadList().catch(showError)
        }
      }),
    [reloadList]
  )

  useEffect(() => {
    if (scrollPinned) messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight })
  }, [conversation, scrollPinned])

  const resetConversation = (): void => {
    conversationRef.current = null
    setConversation(null)
    setHistoryOpen(false)
    setRename(null)
    setScrollPinned(true)
  }
  const newChat = (): void => {
    if (busy || modelChanging) return
    resetConversation()
    attachmentImportRef.current?.abort()
    setDraft('')
    setAttachments([])
    setSummarize(false)
    setError('')
    composerRef.current?.focus()
  }
  useAppShortcuts(
    {
      'new-chat': () => {
        if (visible && !settingsOpen && document) newChat()
      }
    },
    true
  )
  const openConversation = async (id: string): Promise<void> => {
    if (busy || modelChanging) return
    if (id === conversationRef.current?.id) {
      setHistoryOpen(false)
      return
    }
    const chat = await window.lepis.ai.conversation(id)
    conversationRef.current = chat
    setConversation(chat)
    setHistoryOpen(false)
    setRename(null)
    setScrollPinned(true)
  }
  const renameHistory = async (id: string, title: string): Promise<void> => {
    await window.lepis.ai.renameConversation(id, title)
    await reloadList()
  }
  const deleteHistory = async (id: string): Promise<void> => {
    await window.lepis.ai.deleteConversation(id)
    if (conversationRef.current?.id === id) {
      conversationRef.current = null
      setConversation(null)
      setRename(null)
    }
    await reloadList()
  }
  const recentChats = conversations.filter((chat) => chat.id !== conversation?.id)
  const historyProps = {
    disabled: busy || modelChanging,
    onOpen: openConversation,
    onRename: renameHistory,
    onDelete: deleteHistory,
    onError: showError
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
  const attachFiles = async (files: File[]): Promise<void> => {
    if (!files.length || attachmentImportRef.current || stale || !document || loginBusy) return
    const controller = new AbortController()
    attachmentImportRef.current = controller
    setAttachingFiles(true)
    setError('')
    try {
      const items = await readExternalAttachments(files, attachments, controller.signal)
      controller.signal.throwIfAborted()
      setAttachments((current) => [...current, ...items])
      composerRef.current?.focus({ preventScroll: true })
    } catch (error) {
      if (!controller.signal.aborted) showError(error)
    } finally {
      attachmentImportRef.current = null
      setAttachingFiles(false)
    }
  }
  const forkConversation = async (messageId: string): Promise<void> => {
    const current = conversationRef.current
    if (!current || busy || modelChanging || requestRef.current || forkingRef.current) return
    forkingRef.current = true
    setForking(true)
    setError('')
    try {
      const fork = await window.lepis.ai.forkConversation(current.id, messageId)
      conversationRef.current = fork
      setConversation(fork)
      setRename(null)
      setScrollPinned(true)
      await reloadList()
      composerRef.current?.focus()
    } catch (error) {
      showError(error)
    } finally {
      forkingRef.current = false
      setForking(false)
    }
  }
  const send = async (
    retry?: ChatMessage,
    edit?: { message: ChatMessage; text: string }
  ): Promise<boolean> => {
    if (
      !ready ||
      attachmentImportRef.current ||
      requestRef.current ||
      forkingRef.current ||
      (!retry && !edit && !draft.trim() && !attachments.length)
    )
      return false
    const id = crypto.randomUUID()
    const composerSubmission = !retry && !edit
    const submittedDraft = draft
    const submittedAttachments = attachments
    const submittedSummarize = summarize
    requestRef.current = id
    setRequestId(id)
    setError('')
    setScrollPinned(true)
    if (composerSubmission) {
      setDraft('')
      setAttachments([])
      setSummarize(false)
    }
    try {
      const chat: Conversation = conversation ?? {
        id: crypto.randomUUID(),
        documentVersion: document!.version,
        documentPath: tab.path,
        documentName: tab.name,
        provider,
        title: 'New chat',
        updatedAt: 0,
        messages: []
      }
      conversationRef.current = chat
      setConversation(chat)
      if (retry) setConversation({ ...chat, messages: chat.messages.slice(0, -1) })
      requestRef.current = id
      setRequestId(id)
      const pending = window.lepis.ai.send({
        requestId: id,
        conversationId: chat.id,
        newConversation: conversation
          ? undefined
          : { version: document!.version, path: tab.path, provider },
        model: selectedModel,
        reasoning: selectedReasoning,
        text: edit?.text ?? submittedDraft,
        attachments: submittedAttachments,
        summarize: submittedSummarize,
        retryMessageId: retry?.id,
        editMessageId: edit?.message.id
      })
      await pending
      return true
    } catch (error) {
      showError(error)
      if (composerSubmission) {
        setDraft((current) =>
          !current || current === submittedDraft
            ? submittedDraft
            : [submittedDraft, current].filter(Boolean).join('\n\n')
        )
        setAttachments((current) => [
          ...submittedAttachments.filter(
            (submitted) => !current.some((attachment) => attachment.id === submitted.id)
          ),
          ...current
        ])
        setSummarize((current) => current || submittedSummarize)
      }
      if (!conversation && !conversationRef.current?.messages.length) {
        conversationRef.current = null
        setConversation(null)
      }
      if ((retry || edit) && conversation) {
        const latest = await window.lepis.ai.conversation(conversation.id)
        conversationRef.current = latest
        setConversation(latest)
      }
      return false
    } finally {
      setRequestId(null)
      requestRef.current = null
    }
  }
  const cite = useCallback(
    (source: DocumentSource): void => {
      if (!document || stale) return
      onShowDocument()
      requestAnimationFrame(() => {
        if (activeRef.current) getViewer(tab.id)?.showCitation(source)
      })
    },
    [document, stale, onShowDocument, getViewer, tab.id]
  )
  const saveSelection = async (update: Partial<AiSettings>): Promise<void> => {
    setModelChanging(true)
    try {
      await window.lepis.ai.settings(update)
      if (update.provider && conversation && conversation.provider !== update.provider)
        resetConversation()
      setStatus((current) =>
        current
          ? {
              ...current,
              settings: {
                ...current.settings,
                ...update,
                models: { ...current.settings.models, ...update.models },
                reasoning: { ...current.settings.reasoning, ...update.reasoning }
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
  const chooseModel = async (value: string): Promise<void> => {
    if (!status || modelChanging) return
    const group = catalog.find((group) =>
      group.models.some((model) => `${group.provider}:${model.id}` === value)
    )
    const model = group?.models.find((model) => `${group.provider}:${model.id}` === value)
    if (
      !group ||
      !model ||
      !status.connected.includes(group.provider) ||
      (busy && group.provider !== provider)
    )
      return
    await saveSelection({ provider: group.provider, models: { [group.provider]: model.id } })
  }
  const chooseReasoning = async (level: ReasoningLevel): Promise<void> => {
    if (!status || modelChanging || !levels.includes(level)) return
    await saveSelection({ reasoning: { [reasoningKey]: level } })
  }
  const action = (text: string, whole = false): void => {
    setDraft(text)
    setSummarize(whole)
    composerRef.current?.focus()
  }
  const saveTitle = (): void => {
    if (!conversation?.messages.length || rename === null) return
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
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      aria-label="AI chat panel"
      style={{ '--chat-font-size': `${status?.settings.chatFontSize ?? 14}px` } as CSSProperties}
    >
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        {historyOpen ? (
          <div className="mr-auto flex min-w-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Back to chat"
                  onClick={() => setHistoryOpen(false)}
                >
                  <ChevronLeft />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Back to chat</TooltipContent>
            </Tooltip>
            <span className="text-sm font-semibold">All chats</span>
          </div>
        ) : rename !== null ? (
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
            className="mr-auto min-w-36 max-w-[calc(100%-7rem)] justify-start px-2 text-sm font-semibold disabled:opacity-100"
            aria-label="Rename conversation"
            title={conversation?.messages.length ? 'Click to rename conversation' : undefined}
            disabled={!conversation?.messages.length || busy}
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
              aria-keyshortcuts="Meta+Shift+O"
              disabled={!document || busy || modelChanging}
              onClick={newChat}
            >
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New chat (⌘⇧O)</TooltipContent>
        </Tooltip>
        <Dialog open={settingsOpen && visible} onOpenChange={setSettingsOpen}>
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
            <DialogContent
              className="max-h-[85vh] overflow-y-auto sm:max-w-xl"
              onCloseAutoFocus={(event) => {
                if (visible && !historyOpen) {
                  event.preventDefault()
                  composerRef.current?.focus({ preventScroll: true })
                }
              }}
            >
              <DialogHeader>
                <DialogTitle>AI settings</DialogTitle>
                <DialogDescription className="sr-only">
                  Manage AI connections and chat appearance.
                </DialogDescription>
              </DialogHeader>
              <AiSettingsView
                status={status}
                onStatus={(value) => {
                  setStatus(value)
                  setConnectionRevision((revision) => revision + 1)
                }}
                onSettings={(settings) => {
                  setStatus((current) =>
                    current
                      ? { ...current, settings: { ...current.settings, ...settings } }
                      : current
                  )
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
              <Button variant="link" size="xs" onClick={newChat}>
                Start new chat
              </Button>
            </div>
          )}
          <div
            ref={messagesRef}
            className={`min-h-0 flex-1 overflow-auto p-4 ${!historyOpen && !conversation?.messages.length ? 'flex flex-col' : ''}`}
            onScroll={(event) => {
              const element = event.currentTarget
              setScrollPinned(element.scrollHeight - element.scrollTop - element.clientHeight < 80)
            }}
          >
            {historyOpen ? (
              <ConversationHistory chats={conversations} label="All chats" {...historyProps} />
            ) : (
              !conversation?.messages.length && (
                <div
                  aria-label="Chat empty state"
                  className="flex flex-1 items-center justify-center"
                >
                  <div className="w-full max-w-sm space-y-3">
                    {recentChats.length ? (
                      <>
                        <ConversationHistory
                          chats={recentChats.slice(0, 5)}
                          label="Recent chats"
                          {...historyProps}
                        />
                        {recentChats.length > 5 && (
                          <div className="flex justify-center">
                            <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
                              Show more
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-5 text-center">
                        <h2 className="max-w-64 text-lg font-bold leading-snug">
                          What would you like to know about this PDF?
                        </h2>
                        <div className="flex max-w-72 flex-wrap justify-center gap-2">
                          {[
                            {
                              label: 'Summarize',
                              prompt:
                                'Summarize the entire document, covering its main arguments and conclusions.',
                              whole: true
                            },
                            {
                              label: 'Explain key concepts',
                              prompt: 'Explain the key concepts in this PDF.',
                              whole: false
                            },
                            {
                              label: 'Find information',
                              prompt: 'Find information about ',
                              whole: false
                            }
                          ].map(({ label, prompt, whole }) => (
                            <Button
                              key={label}
                              variant="outline"
                              size="sm"
                              className="rounded-full text-xs font-normal shadow-none"
                              disabled={busy || modelChanging}
                              onClick={() => action(prompt, whole)}
                            >
                              {label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            )}
            <MessageGroup className="gap-7">
              {!historyOpen &&
                conversation?.messages.map((message, index) => (
                  <ChatMessageView
                    key={message.id}
                    message={message}
                    provider={conversation.provider}
                    stale={stale || !document}
                    retry={
                      !busy &&
                      !stale &&
                      index === conversation.messages.length - 1 &&
                      message.status !== 'streaming'
                    }
                    editable={ready}
                    forkable={!busy && !modelChanging}
                    onEdit={(text) => send(undefined, { message, text })}
                    onFork={() => void forkConversation(message.id)}
                    onCitation={cite}
                    onRetry={() => void send(message)}
                    onError={setError}
                  />
                ))}
            </MessageGroup>
            {busy &&
              !historyOpen &&
              !conversation?.messages.some((message) => message.status === 'streaming') && (
                <div role="status" className="py-2">
                  <ChatActivity
                    work={{
                      parts: [],
                      durationMs: 0
                    }}
                    running
                    provider={provider}
                    model={selectedModel}
                  />
                </div>
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
          {!historyOpen && (
            <div className="shrink-0 space-y-2 p-3">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                aria-label="Attach external files"
                accept={externalAttachmentAccept}
                multiple
                disabled={attachingFiles}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  void attachFiles(files)
                }}
              />
              {attachingFiles && (
                <p role="status" className="text-xs text-muted-foreground">
                  Reading attachments…
                </p>
              )}
              {attachments.length > 0 && (
                <>
                  <div className="flex max-h-32 flex-wrap gap-2 overflow-auto">
                    {attachments.map((attachment) => {
                      const removeLabel =
                        attachment.kind === 'file'
                          ? `Remove ${attachment.name}`
                          : `Remove selection on page ${attachment.page}`
                      return (
                        <div
                          className="relative w-24 rounded-md border p-1.5 text-[11px] [&_img]:h-12"
                          key={attachment.id}
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                className="absolute -right-1 -top-1 rounded-full border bg-background p-0.5"
                                aria-label={removeLabel}
                                onClick={() =>
                                  setAttachments((current) =>
                                    current.filter((item) => item.id !== attachment.id)
                                  )
                                }
                              >
                                <X className="size-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{removeLabel}</TooltipContent>
                          </Tooltip>
                          <ChatAttachmentPreview attachment={attachment} />
                        </div>
                      )
                    })}
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
                className="w-full"
              >
                <ChatComposerDropZone
                  disabled={attachingFiles || stale || !document || Boolean(loginBusy)}
                  onFiles={(files) => void attachFiles(files)}
                >
                  <InputGroupTextarea
                    ref={composerRef}
                    aria-label="Message AI"
                    className="max-h-40 min-h-20"
                    style={{ fontSize: 'var(--chat-font-size)' }}
                    placeholder={
                      !connected ? 'Connect an AI service in settings' : 'Ask about this PDF…'
                    }
                    value={draft}
                    maxLength={16000}
                    disabled={Boolean(loginBusy)}
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
                  <InputGroupAddon align="block-end" className="text-foreground">
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <InputGroupButton
                              size="icon-sm"
                              aria-label="Add attachment"
                              disabled={stale || !document}
                              onMouseDown={(event) => event.preventDefault()}
                            >
                              <Paperclip />
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
                          disabled={attachingFiles}
                          onSelect={() => fileInputRef.current?.click()}
                        >
                          <FilePlus />
                          Attach files
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            onSelectRegion((attachment) => addAttachments([attachment]))
                          }
                        >
                          <Crop />
                          Attach pdf region
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <ChatModelSelector
                      catalog={catalog}
                      provider={provider}
                      model={connected ? model : undefined}
                      selectedReasoning={selectedReasoning}
                      busy={busy}
                      loading={modelsLoading}
                      disabled={modelChanging}
                      onModelChange={(value) => void chooseModel(value)}
                      onReasoningChange={(level) => void chooseReasoning(level)}
                    />
                    {busy ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <InputGroupButton
                            type="button"
                            variant="default"
                            size="icon-sm"
                            aria-label="Stop response"
                            onClick={() => {
                              if (requestRef.current) void window.lepis.ai.stop(requestRef.current)
                            }}
                          >
                            <Square className="fill-current" />
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
                            aria-label="Send message"
                            disabled={
                              !ready || attachingFiles || (!draft.trim() && !attachments.length)
                            }
                          >
                            <ArrowUp />
                          </InputGroupButton>
                        </TooltipTrigger>
                        <TooltipContent>Send message</TooltipContent>
                      </Tooltip>
                    )}
                  </InputGroupAddon>
                </ChatComposerDropZone>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  )
}
