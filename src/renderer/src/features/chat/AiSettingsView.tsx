import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ProviderLogo } from './ProviderLogo'
import type { AiProvider, ApiProvider, AiSettings, AiStatus } from '../../../../shared/ai'
import { providerSections } from './labels'

const connectionNames: Record<AiProvider, string> = {
  chatgpt: 'ChatGPT',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Gemini',
  openrouter: 'OpenRouter'
}

type Props = {
  status: AiStatus
  onStatus(status: AiStatus): void
  onSettings(settings: Partial<AiSettings>): void
  onError(error: string): void
}

export function AiSettingsView({
  status,
  onStatus,
  onSettings,
  onError
}: Props): React.JSX.Element {
  const [section, setSection] = useState<ApiProvider>(
    status.settings.provider === 'chatgpt' ? 'openai' : status.settings.provider
  )
  const [key, setKey] = useState('')
  const [updating, setUpdating] = useState(false)
  const loginBusy = !['idle', 'error'].includes(status.chatgptLogin.phase)
  const busy = updating || loginBusy
  const loginLabels = {
    idle: 'Connect ChatGPT',
    preparing: 'Preparing sign-in…',
    'waiting-browser': 'Complete sign-in in your browser…',
    'exchanging-code': 'Completing authorization…',
    'verifying-identity': 'Verifying your account…',
    'saving-session': 'Saving connection…',
    error: 'Retry sign-in'
  }
  const run = async (action: () => Promise<AiStatus>): Promise<void> => {
    setUpdating(true)
    onError('')
    try {
      onStatus(await action())
      setKey('')
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not update the connection.')
      // A failed remote revocation can still complete the local disconnection.
      await window.lepis.ai
        .status()
        .then(onStatus)
        .catch(() => {})
    } finally {
      setUpdating(false)
    }
  }
  const saveSettings = async (settings: Partial<AiSettings>): Promise<void> => {
    setUpdating(true)
    onError('')
    try {
      await window.lepis.ai.settings(settings)
      onSettings(settings)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not save AI settings.')
    } finally {
      setUpdating(false)
    }
  }
  return (
    <section aria-label="AI settings" className="space-y-5 text-sm">
      <Tabs
        orientation="vertical"
        value={section}
        onValueChange={(value) => {
          setSection(value as ApiProvider)
          setKey('')
          onError('')
        }}
        className="flex-col gap-5 sm:flex-row"
      >
        <TabsList
          aria-label="AI providers"
          className="w-full shrink-0 gap-1 bg-transparent p-0 sm:w-40"
        >
          {providerSections.map(({ id, name, providers }) => {
            const connected = providers.some((provider) => status.connected.includes(provider))
            return (
              <TabsTrigger
                key={id}
                value={id}
                disabled={busy}
                className="h-auto flex-none justify-start rounded-md px-3 py-2 text-left data-active:bg-muted data-active:shadow-none"
              >
                <ProviderLogo provider={id} className="mr-1" />
                <span className="flex flex-1 flex-col gap-0.5">
                  <span>{name}</span>
                  <span className="text-[11px] font-normal text-muted-foreground">
                    {connected ? 'Connected' : 'Not connected'}
                  </span>
                </span>
                {connected && (
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>
        {providerSections.map(({ id, providers }) => (
          <TabsContent key={id} value={id} className="min-w-0 space-y-4 sm:border-l sm:pl-5">
            {section === id &&
              providers.map((provider) => {
                const connected = status.connected.includes(provider)
                return (
                  <section
                    key={provider}
                    aria-label={`${connectionNames[provider]} connection`}
                    className="space-y-3 border-b pb-4 last:border-0 last:pb-0"
                  >
                    <h3 className="font-medium">
                      {provider === 'chatgpt'
                        ? 'ChatGPT plan'
                        : provider === 'openai'
                          ? 'OpenAI API'
                          : connectionNames[provider]}
                    </h3>
                    {provider === 'chatgpt' ? (
                      <>
                        {status.chatgptAccount && (
                          <p className="break-all text-xs text-muted-foreground">
                            {status.chatgptAccount}
                          </p>
                        )}
                        {status.chatgptLogin.phase === 'error' && (
                          <p role="alert" className="text-xs text-destructive">
                            {status.chatgptLogin.error}
                          </p>
                        )}
                        {loginBusy && (
                          <p role="status" className="text-xs text-muted-foreground">
                            {loginLabels[status.chatgptLogin.phase]}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <Input
                          type="password"
                          autoComplete="off"
                          aria-label={`${connectionNames[provider]} API key`}
                          placeholder={connected ? 'Replace API key' : 'API key'}
                          value={key}
                          onChange={(event) => setKey(event.target.value)}
                          disabled={busy}
                        />
                      </>
                    )}
                    <div className="flex flex-wrap justify-end gap-2">
                      {(connected || (provider === 'chatgpt' && status.chatgptAccount)) && (
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => void run(() => window.lepis.ai.disconnect(provider))}
                        >
                          Disconnect
                        </Button>
                      )}
                      {provider === 'chatgpt' ? (
                        loginBusy ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void window.lepis.ai.cancelLogin()}
                          >
                            Cancel
                          </Button>
                        ) : (
                          !connected && (
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => void run(() => window.lepis.ai.connectChatgpt())}
                            >
                              {status.chatgptAccount
                                ? 'Enable plan access'
                                : loginLabels[status.chatgptLogin.phase]}
                            </Button>
                          )
                        )
                      ) : (
                        <Button
                          size="sm"
                          disabled={busy || key.trim().length < 8}
                          onClick={() => void run(() => window.lepis.ai.setKey(provider, key))}
                        >
                          Save key
                        </Button>
                      )}
                    </div>
                  </section>
                )
              })}
          </TabsContent>
        ))}
      </Tabs>
      <div className="flex items-center justify-between gap-4 border-t pt-4">
        <label htmlFor="chat-font-size" className="font-medium">
          Chat text size
        </label>
        <Select
          value={String(status.settings.chatFontSize)}
          disabled={busy}
          onValueChange={(value) => void saveSettings({ chatFontSize: Number(value) })}
        >
          <SelectTrigger id="chat-font-size" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 13 }, (_, index) => index + 12).map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} px{size === 14 ? ' (default)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-start gap-2 border-t pt-4 text-xs text-muted-foreground">
        <Checkbox
          aria-label="Allow AI requests"
          checked={status.settings.consent}
          disabled={busy}
          onCheckedChange={(checked) => void saveSettings({ consent: checked === true })}
        />
        Share document excerpts and chat context with the selected provider.
      </label>
    </section>
  )
}
