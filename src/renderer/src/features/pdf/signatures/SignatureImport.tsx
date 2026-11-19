import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SignatureCropEditor } from './SignatureCropEditor'
import {
  fullSignatureCrop,
  importSignatureImage,
  maxSignatureImageMB,
  prepareSignatureImage,
  signatureImageTypes,
  type SignatureCrop
} from './signatureImages'

type Props = {
  onChange(dataUrl: string | null): void
  onPreparingChange(preparing: boolean): void
}
type ImageEdit = {
  source: HTMLCanvasElement
  crop: SignatureCrop
  removeBackground: boolean
}

export function SignatureImport({ onChange, onPreparingChange }: Props): React.JSX.Element {
  const [edit, setEdit] = useState<ImageEdit | null>(null)
  const [prepared, setPrepared] = useState<{ edit: ImageEdit; error: string | null } | null>(null)
  const [reading, setReading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const busy = reading || (edit !== null && edit !== prepared?.edit)
  const error = fileError ?? (edit === prepared?.edit ? prepared.error : null)

  useLayoutEffect(() => onPreparingChange(busy), [busy, onPreparingChange])

  useEffect(
    () => () => {
      generation.current++
    },
    []
  )
  useEffect(() => {
    if (!edit) return
    const timer = window.setTimeout(() => {
      let dataUrl: string | null = null
      let error: string | null = null
      try {
        const result = prepareSignatureImage(edit.source, edit.crop, edit.removeBackground)
        dataUrl = result?.toDataURL('image/png') ?? null
        if (!dataUrl) error = 'No signature found. Adjust the crop or turn off background removal.'
      } catch {
        error = 'The signature could not be extracted. Try turning off background removal.'
      }
      setPrepared({ edit, error })
      onChange(dataUrl)
    }, 100)
    return () => window.clearTimeout(timer)
  }, [edit, onChange])

  function changeEdit(next: ImageEdit): void {
    setFileError(null)
    setEdit(next)
  }

  async function loadImage(file: File): Promise<void> {
    const token = ++generation.current
    setFileError(null)
    setReading(true)
    try {
      const source = await importSignatureImage(file)
      if (generation.current !== token) return
      setEdit((previous) => ({
        source,
        crop: fullSignatureCrop,
        removeBackground: previous?.removeBackground ?? true
      }))
    } catch (error) {
      if (generation.current === token)
        setFileError(error instanceof Error ? error.message : 'The image could not be opened.')
    } finally {
      if (generation.current === token) setReading(false)
    }
  }

  return (
    <div className="grid gap-3">
      <input
        ref={fileInput}
        className="hidden"
        type="file"
        aria-label="Signature image"
        accept={signatureImageTypes.join(',')}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void loadImage(file)
        }}
      />
      {edit ? (
        <>
          <SignatureCropEditor
            source={edit.source}
            crop={edit.crop}
            onChange={(crop) => {
              if (crop !== edit.crop) changeEdit({ ...edit, crop })
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={edit.removeBackground}
                onCheckedChange={(checked) =>
                  changeEdit({ ...edit, removeBackground: checked === true })
                }
              />
              Remove background
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInput.current?.click()}
            >
              Replace image
            </Button>
          </div>
        </>
      ) : (
        <div
          data-signature-image-drop-zone
          data-dragging={dragging}
          className="flex aspect-5/2 w-full min-w-0 flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 py-2 text-center data-[dragging=true]:border-primary data-[dragging=true]:bg-primary/10"
          onDragEnter={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return
            dragDepth.current++
            setDragging(true)
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1)
            if (dragDepth.current === 0) setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            dragDepth.current = 0
            setDragging(false)
            const file = event.dataTransfer.files[0]
            if (file) void loadImage(file)
          }}
        >
          <div className="grid gap-1">
            <p className="font-medium">Drag an image here</p>
            <p className="text-xs text-muted-foreground">
              PNG, JPEG or WebP · Up to {maxSignatureImageMB} MB
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
            Choose image
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
