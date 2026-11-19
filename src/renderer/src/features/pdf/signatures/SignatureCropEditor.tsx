import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import type { SignatureCrop } from './signatureImages'

type Handle = {
  label: string
  position: string
  x?: 'left' | 'right'
  y?: 'top' | 'bottom'
}

const handles: Handle[] = [
  { label: 'top left', position: 'top-0 left-0 cursor-nwse-resize', x: 'left', y: 'top' },
  { label: 'top', position: 'top-0 left-1/2 cursor-ns-resize', y: 'top' },
  { label: 'top right', position: 'top-0 left-full cursor-nesw-resize', x: 'right', y: 'top' },
  { label: 'left', position: 'top-1/2 left-0 cursor-ew-resize', x: 'left' },
  { label: 'right', position: 'top-1/2 left-full cursor-ew-resize', x: 'right' },
  { label: 'bottom left', position: 'top-full left-0 cursor-nesw-resize', x: 'left', y: 'bottom' },
  { label: 'bottom', position: 'top-full left-1/2 cursor-ns-resize', y: 'bottom' },
  {
    label: 'bottom right',
    position: 'top-full left-full cursor-nwse-resize',
    x: 'right',
    y: 'bottom'
  }
]

const minimumCrop = 1

function resizeCrop(crop: SignatureCrop, handle: Handle, dx: number, dy: number): SignatureCrop {
  const next = { ...crop }
  if (handle.x === 'left')
    next.left = Math.max(0, Math.min(crop.left + dx, crop.right - minimumCrop))
  if (handle.x === 'right')
    next.right = Math.min(100, Math.max(crop.right + dx, crop.left + minimumCrop))
  if (handle.y === 'top') next.top = Math.max(0, Math.min(crop.top + dy, crop.bottom - minimumCrop))
  if (handle.y === 'bottom')
    next.bottom = Math.min(100, Math.max(crop.bottom + dy, crop.top + minimumCrop))
  if (
    next.left === crop.left &&
    next.right === crop.right &&
    next.top === crop.top &&
    next.bottom === crop.bottom
  )
    return crop
  return next
}

type Props = { source: HTMLCanvasElement; crop: SignatureCrop; onChange(crop: SignatureCrop): void }

export function SignatureCropEditor({ source, crop, onChange }: Props): React.JSX.Element {
  const image = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; width: number; height: number }>(null)
  const [draft, setDraft] = useState<SignatureCrop | null>(null)
  const selection = draft ?? crop

  useLayoutEffect(() => {
    image.current?.replaceChildren(source)
  }, [source])

  function pointerCrop(
    event: PointerEvent<HTMLButtonElement>,
    handle: Handle
  ): SignatureCrop | null {
    const start = drag.current
    if (start?.id !== event.pointerId) return null
    return resizeCrop(
      crop,
      handle,
      ((event.clientX - start.x) * 100) / start.width,
      ((event.clientY - start.y) * 100) / start.height
    )
  }

  function clearDrag(event: PointerEvent<HTMLButtonElement>): void {
    if (drag.current?.id !== event.pointerId) return
    drag.current = null
    setDraft(null)
  }

  return (
    <div className="min-w-0 p-2">
      <div className="relative mx-auto w-fit max-w-full">
        <div
          ref={image}
          role="img"
          aria-label="Original signature image"
          className="[&>canvas]:block [&>canvas]:h-auto [&>canvas]:max-h-40 [&>canvas]:w-auto [&>canvas]:max-w-full [&>canvas]:rounded-md [&>canvas]:bg-white"
        />
        <div
          data-signature-crop
          className="pointer-events-none absolute bg-sky-500/10 ring-2 ring-sky-600 ring-inset"
          style={{
            left: `${selection.left}%`,
            top: `${selection.top}%`,
            width: `${selection.right - selection.left}%`,
            height: `${selection.bottom - selection.top}%`
          }}
        >
          {handles.map((handle) => (
            <button
              key={handle.label}
              type="button"
              aria-label={`Resize crop from ${handle.label}`}
              className={`pointer-events-auto absolute grid size-4 -translate-1/2 touch-none place-items-center rounded-sm after:size-2.5 after:rounded-xs after:border after:border-sky-700 after:bg-white focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${handle.position}`}
              onPointerDown={(event) => {
                if (event.button !== 0 || drag.current) return
                const bounds = image.current?.getBoundingClientRect()
                if (!bounds?.width || !bounds.height) return
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                drag.current = {
                  id: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  width: bounds.width,
                  height: bounds.height
                }
              }}
              onPointerMove={(event) => {
                const next = pointerCrop(event, handle)
                if (next) setDraft(next)
              }}
              onPointerUp={(event) => {
                const next = pointerCrop(event, handle)
                if (!next) return
                clearDrag(event)
                onChange(next)
              }}
              onPointerCancel={clearDrag}
              onLostPointerCapture={clearDrag}
              onKeyDown={(event) => {
                if (drag.current) return
                const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
                const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
                if (!(handle.x && dx) && !(handle.y && dy)) return
                event.preventDefault()
                onChange(resizeCrop(crop, handle, dx, dy))
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
