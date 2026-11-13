import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem
} from '@/components/ui/dropdown-menu'
import type { AiModel, AiProvider, ReasoningLevel } from '../../../../shared/ai'
import { providerSections, reasoningLabels } from './labels'
import { ProviderLogo } from './ProviderLogo'

export type ModelCatalog = { provider: AiProvider; models: AiModel[]; error?: string }[]

type Props = {
  catalog: ModelCatalog
  provider: AiProvider
  model?: AiModel
  selectedReasoning?: ReasoningLevel
  busy: boolean
  loading: boolean
  disabled: boolean
  onModelChange(value: string): void
  onReasoningChange(level: ReasoningLevel): void
}

export function ChatModelSelector({
  catalog,
  provider,
  model,
  selectedReasoning,
  busy,
  loading,
  disabled,
  onModelChange,
  onReasoningChange
}: Props): React.JSX.Element {
  const levels = model?.reasoningLevels ?? []
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          aria-label="AI model"
          variant="ghost"
          size="sm"
          className="ml-auto min-w-0 max-w-[calc(100%-6rem)] shrink gap-2 px-2 font-normal"
          disabled={disabled || loading || !catalog.some((group) => group.models.length)}
        >
          {model ? (
            <>
              <ProviderLogo provider={provider} />
              <span className="truncate">{model.name}</span>
            </>
          ) : (
            <span className="truncate">{loading ? 'Loading models…' : 'Choose model'}</span>
          )}
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-40">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger aria-label="Select model">Model</DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            align="end"
            className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto"
          >
            <DropdownMenuRadioGroup
              aria-label="Models"
              value={model ? `${provider}:${model.id}` : ''}
              onValueChange={onModelChange}
            >
              {providerSections.map((section) => {
                const groups = catalog.filter(
                  (group) => section.providers.includes(group.provider) && group.models.length
                )
                if (!groups.length) return null
                return (
                  <div key={section.id}>
                    <DropdownMenuLabel>{section.name}</DropdownMenuLabel>
                    {groups.flatMap((group) =>
                      group.models.map((model) => (
                        <DropdownMenuRadioItem
                          value={`${group.provider}:${model.id}`}
                          key={`${group.provider}:${model.id}`}
                          disabled={disabled || (busy && group.provider !== provider)}
                        >
                          <ProviderLogo provider={group.provider} />
                          {model.name}
                        </DropdownMenuRadioItem>
                      ))
                    )}
                  </div>
                )
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger aria-label="Select effort" disabled={!selectedReasoning}>
            Effort
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            align="end"
            className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto"
          >
            <DropdownMenuRadioGroup
              aria-label="Thinking time"
              value={selectedReasoning}
              onValueChange={(value) => onReasoningChange(value as ReasoningLevel)}
            >
              {levels.map((level) => (
                <DropdownMenuRadioItem key={level} value={level} disabled={disabled}>
                  {reasoningLabels[level]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
