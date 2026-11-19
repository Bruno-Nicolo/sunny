import { useRef, useState, type PointerEvent } from 'react'
import { Undo2, Redo2, Eraser } from 'lucide-react'
import { ToolbarButton } from '@/components/ToolbarButton'
import { ButtonGroup } from '@/components/ui/button-group'
import { Slider } from '@/components/ui/slider'
import { paintSignature, trimSignature, type SignatureStroke } from './signatureImages'

type Props = { onChange(dataUrl: string | null): void }

export function SignatureDraw({ onChange }: Props): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const history = useRef<SignatureStroke[][]>([[]])
  const position = useRef(0)
  const current = useRef<{ id: number; stroke: SignatureStroke } | null>(null)
  const [commands, setCommands] = useState({ undo: 0, redo: 0, clear: false })
  const [thickness, setThickness] = useState(3)
  function repaint(): void {
    paintSignature(canvas.current!, history.current[position.current])
    setCommands({
      undo: position.current,
      redo: history.current.length - position.current - 1,
      clear: history.current[position.current].length > 0
    })
    onChange(trimSignature(canvas.current!)?.toDataURL('image/png') ?? null)
  }
  function record(strokes: SignatureStroke[]): void {
    history.current.splice(position.current + 1)
    history.current.push(strokes)
    position.current++
    repaint()
  }
  function append(event: PointerEvent<HTMLCanvasElement>): boolean {
    const gesture = current.current
    if (!gesture || event.pointerId !== gesture.id) return false
    const bounds = event.currentTarget.getBoundingClientRect()
    const events = event.nativeEvent.getCoalescedEvents?.() ?? []
    const points = gesture.stroke.points
    const previousLength = points.length
    for (const point of events.length ? events : [event.nativeEvent]) {
      const x = Math.max(0, Math.min(1000, ((point.clientX - bounds.left) * 1000) / bounds.width))
      const y = Math.max(0, Math.min(400, ((point.clientY - bounds.top) * 400) / bounds.height))
      if (
        points.length &&
        Math.hypot(x - points[points.length - 2], y - points[points.length - 1]) < 0.5
      )
        continue
      points.push(x, y)
    }
    if (points.length === previousLength) return false
    gesture.stroke.path = undefined
    return true
  }

  function preview(event: PointerEvent<HTMLCanvasElement>): void {
    if (append(event) && current.current)
      paintSignature(event.currentTarget, [
        ...history.current[position.current],
        current.current.stroke
      ])
  }
  function cancel(): void {
    if (!current.current) return
    current.current = null
    paintSignature(canvas.current!, history.current[position.current])
  }
  return (
    <div className="grid gap-3">
      <canvas
        ref={canvas}
        width={1000}
        height={400}
        aria-label="Draw your signature"
        className="signature-drawing h-auto w-full min-w-0 rounded-md border bg-white"
        style={{ touchAction: 'none', aspectRatio: '5 / 2' }}
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
          append(event)
          const stroke = current.current.stroke
          current.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
          record([...history.current[position.current], stroke])
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
            disabled={!commands.undo}
            onClick={() => {
              position.current--
              repaint()
            }}
          >
            <Undo2 />
          </ToolbarButton>
          <ToolbarButton
            data-slot="button"
            label="Redo stroke"
            tooltip="Redo"
            variant="outline"
            disabled={!commands.redo}
            onClick={() => {
              position.current++
              repaint()
            }}
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
            disabled={!commands.clear}
            onClick={() => record([])}
          >
            <Eraser />
          </ToolbarButton>
        </ButtonGroup>
      </div>
    </div>
  )
}
