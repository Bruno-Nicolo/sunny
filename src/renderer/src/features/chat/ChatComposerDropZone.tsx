import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { FilePlus } from 'lucide-react'
import { InputGroup } from '@/components/ui/input-group'

type Props = {
  disabled: boolean
  onFiles(files: File[]): void
  children: ReactNode
}

/** Keep file drops inside the composer and leave text dragging to the input. */
export function ChatComposerDropZone({ disabled, onFiles, children }: Props): React.JSX.Element {
  const depth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const isFileDrag = (event: DragEvent): boolean => event.dataTransfer.types.includes('Files')

  return (
    <InputGroup
      data-chat-composer
      onDragEnter={(event) => {
        if (!isFileDrag(event)) return
        event.preventDefault()
        event.stopPropagation()
        depth.current++
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (!isFileDrag(event)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
      }}
      onDragLeave={(event) => {
        if (!isFileDrag(event)) return
        event.preventDefault()
        event.stopPropagation()
        depth.current = Math.max(0, depth.current - 1)
        if (!depth.current) setDragging(false)
      }}
      onDrop={(event) => {
        if (!isFileDrag(event)) return
        event.preventDefault()
        event.stopPropagation()
        depth.current = 0
        setDragging(false)
        if (!disabled) onFiles(Array.from(event.dataTransfer.files))
      }}
    >
      {children}
      {dragging && !disabled && (
        <div
          role="status"
          className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-primary bg-background/95 text-sm text-foreground"
        >
          <FilePlus className="mb-1 size-5 text-primary" />
          <span className="font-medium">Drop files to attach</span>
          <span className="text-xs text-muted-foreground">PDF, text and images</span>
        </div>
      )}
    </InputGroup>
  )
}
