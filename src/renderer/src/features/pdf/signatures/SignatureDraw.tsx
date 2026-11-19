import { useRef, useState, type PointerEvent } from 'react'
import { Undo2, Redo2, Eraser } from 'lucide-react'
import { ToolbarButton } from '@/components/ToolbarButton'
import { ButtonGroup } from '@/components/ui/button-group'
import { Slider } from '@/components/ui/slider'
import {
  paintLiveStroke,
  paintSignature,
  trimSignature,
  type SignatureStroke
} from './signatureImages'

type Props = { onChange(dataUrl: string | null): void }

export function SignatureDraw({ onChange }: Props): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [{ steps, position }, setHistory] = useState<{
    steps: SignatureStroke[][]
    position: number
  }>({ steps: [[]], position: 0 })
  const current = useRef<{ id: number; stroke: SignatureStroke } | null>(null)
  const [thickness, setThickness] = useState(3)
  const strokes = steps[position]

  function showStep(index: number, nextSteps = steps): void {
    const surface = canvas.current!
    const nextStrokes = nextSteps[index]
    setHistory({ steps: nextSteps, position: index })
    paintSignature(surface, nextStrokes)
    onChange(nextStrokes.length ? (trimSignature(surface)?.toDataURL('image/png') ?? null) : null)
  }

  function record(next: SignatureStroke[]): void {
    showStep(position + 1, [...steps.slice(0, position + 1), next])
  }

  function append(event: PointerEvent<HTMLCanvasElement>, points: number[]): void {
    const surface = event.currentTarget
    const { left, top, width, height } = surface.getBoundingClientRect()
    const scaleX = surface.width / width
    const scaleY = surface.height / height
    const events = event.nativeEvent.getCoalescedEvents?.() ?? []
    for (const point of events.length ? events : [event.nativeEvent]) {
      const x = Math.max(0, Math.min(surface.width, (point.clientX - left) * scaleX))
      const y = Math.max(0, Math.min(surface.height, (point.clientY - top) * scaleY))
      if (
        points.length &&
        Math.hypot(x - points[points.length - 2], y - points[points.length - 1]) < 0.5
      )
        continue
      points.push(x, y)
    }
  }

  function preview(event: PointerEvent<HTMLCanvasElement>): void {
    const gesture = current.current
    if (gesture?.id !== event.pointerId) return
    const { points } = gesture.stroke
    const from = points.length
    append(event, points)
    if (points.length > from) paintLiveStroke(event.currentTarget, gesture.stroke, from)
  }

  function cancel(event: PointerEvent<HTMLCanvasElement>): void {
    if (current.current?.id !== event.pointerId) return
    current.current = null
    paintSignature(event.currentTarget, strokes)
  }
  return (
    <div className="grid gap-3">
      <canvas
        ref={canvas}
        width={1000}
        height={400}
        aria-label="Draw your signature"
        className="signature-drawing aspect-5/2 h-auto w-full min-w-0 rounded-md border bg-white"
        style={{ touchAction: 'none' }}
        onPointerDown={(event) => {
          if (event.button !== 0 || current.current) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          current.current = { id: event.pointerId, stroke: { points: [], thickness } }
          preview(event)
        }}
        onPointerMove={preview}
        onPointerUp={(event) => {
          if (current.current?.id !== event.pointerId) return
          const stroke = current.current.stroke
          append(event, stroke.points)
          current.current = null
          record([...strokes, stroke])
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3 text-sm">
          <span>Stroke width</span>
          <Slider
            className="w-28"
            aria-label="Signature stroke width"
            min={1}
            max={8}
            step={0.5}
            value={[thickness]}
            onValueChange={([value]) => setThickness(value)}
          />
        </div>
        <ButtonGroup aria-label="Signature history">
          <ToolbarButton
            data-slot="button"
            label="Undo stroke"
            tooltip="Undo"
            variant="outline"
            disabled={position === 0}
            onClick={() => showStep(position - 1)}
          >
            <Undo2 />
          </ToolbarButton>
          <ToolbarButton
            data-slot="button"
            label="Redo stroke"
            tooltip="Redo"
            variant="outline"
            disabled={position === steps.length - 1}
            onClick={() => showStep(position + 1)}
          >
            <Redo2 />
          </ToolbarButton>
        </ButtonGroup>
        <ButtonGroup aria-label="Clear signature">
          <ToolbarButton
            data-slot="button"
            label="Clear signature"
            tooltip="Clear"
            variant="outline"
            disabled={strokes.length === 0}
            onClick={() => record([])}
          >
            <Eraser />
          </ToolbarButton>
        </ButtonGroup>
      </div>
    </div>
  )
}
