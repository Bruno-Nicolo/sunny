import { useRef } from 'react'
import { ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type Props = { disabled: boolean; onAddImages(files: File[]): void }
export function ImageInputButton({ disabled, onAddImages }: Props): React.JSX.Element {
  const imageInputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label="Choose images"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          onAddImages(files)
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Add image"
            disabled={disabled}
            onClick={() => imageInputRef.current?.click()}
          >
            <ImagePlus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add image (or paste with ⌘V)</TooltipContent>
      </Tooltip>
    </>
  )
}
