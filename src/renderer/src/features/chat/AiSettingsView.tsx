import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { AiProvider, AiStatus } from '../../../../shared/ai'

import { providerNames } from './labels'

type Props = { status: AiStatus; onStatus(status: AiStatus): void; onError(error: string): void }

export function AiSettingsView({ status, onStatus, onError }: Props): React.JSX.Element {
  const [provider, setProvider] = useState<AiProvider>(status.settings.provider)
  const [key, setKey] = useState('')
  const [updating, setUpdating] = useState(false)
  const loginBusy = !['idle', 'error'].includes(status.chatgptLogin.phase)
  const busy = updating || loginBusy
  const loginLabels = {
    idle: 'Continue with ChatGPT',
    preparing: 'Preparing secure sign-in…',
    'waiting-browser': 'Complete sign-in in your browser…',
    'exchanging-code': 'Completing authorization…',
    'verifying-identity': 'Verifying your account…',
    'saving-session': 'Saving connection securely…',
    error: 'Retry ChatGPT sign-in'
  }
  const run = async (action: () => Promise<AiStatus>): Promise<void> => {
    setUpdating(true)
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
  return (
    <section aria-label="AI connections" className="space-y-3 border-b p-4 text-sm">
      <p className="font-medium">AI connections</p>
      <select
        aria-label="Connection provider"
        className="chat-select w-full"
        value={provider}
        disabled={busy}
        onChange={(event) => {
          setProvider(event.target.value as AiProvider)
          setKey('')
        }}
      >
        {Object.entries(providerNames).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      {provider === 'chatgpt' ? (
        <>
          <p className="text-xs text-muted-foreground">
            Use your eligible ChatGPT plan. Sign-in opens your browser and requests permission to
            use the plan. Personal ChatGPT conversations are not imported.
          </p>
          {status.chatgptAccount && (
            <p className="truncate text-xs">Account: {status.chatgptAccount}</p>
          )}
          {status.chatgptAccount && !status.connected.includes('chatgpt') && (
            <p className="text-xs text-muted-foreground">
              Signed in. Plan usage is not enabled; authorize it below or choose an API provider.
            </p>
          )}
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void run(() => window.lepis.ai.connectChatgpt())}
          >
            {loginBusy
              ? loginLabels[status.chatgptLogin.phase]
              : status.connected.includes('chatgpt')
                ? 'Reconnect ChatGPT'
                : status.chatgptAccount
                  ? 'Enable ChatGPT plan usage'
                  : loginLabels[status.chatgptLogin.phase]}
          </Button>
          {loginBusy && (
            <Button variant="ghost" size="sm" onClick={() => void window.lepis.ai.cancelLogin()}>
              Cancel
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            API usage is billed separately by the provider. Your key is protected by the operating
            system and is never sent to the PDF viewer.
          </p>
          <input
            className="chat-select w-full"
            type="password"
            autoComplete="off"
            aria-label="API key"
            placeholder={status.connected.includes(provider) ? 'Replace saved API key' : 'API key'}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            disabled={busy}
          />
          <Button
            size="sm"
            disabled={busy || key.trim().length < 8}
            onClick={() => void run(() => window.lepis.ai.setKey(provider, key))}
          >
            Save key
          </Button>
        </>
      )}
      {(status.connected.includes(provider) ||
        (provider === 'chatgpt' && status.chatgptAccount)) && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void run(() => window.lepis.ai.disconnect(provider))}
        >
          Disconnect
        </Button>
      )}
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={status.settings.consent}
          onChange={(event) => {
            const settings = { ...status.settings, consent: event.target.checked }
            void window.lepis.ai
              .settings({ consent: settings.consent })
              .then(() => onStatus({ ...status, settings }))
              .catch((error) => onError(String(error)))
          }}
        />
        Allow document excerpts, selected images and needed conversation history to be sent to the
        chosen AI service.
      </label>
    </section>
  )
}
