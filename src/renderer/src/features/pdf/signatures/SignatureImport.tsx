import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fullSignatureCrop,
  importSignatureImage,
  prepareSignatureImage,
  type SignatureCrop
} from './signatureImages'

type Props = { onChange(dataUrl: string | null): void }

export function SignatureImport({ onChange }: Props): React.JSX.Element {
  const [source, setSource] = useState<HTMLCanvasElement | null>(null)
  const originalPreview = useMemo(() => source?.toDataURL('image/png'), [source])
  const [crop, setCrop] = useState<SignatureCrop>(fullSignatureCrop)
  const [removeBackground, setRemoveBackground] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
    },
    []
  )
  useEffect(() => {
    if (!source) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void prepareSignatureImage(source, crop, removeBackground)
        .then((result) => {
          if (cancelled) return
          onChange(result?.toDataURL('image/png') ?? null)
          setError(
            result ? null : 'No signature found. Adjust the crop or turn off background removal.'
          )
        })
        .catch(() => {
          if (!cancelled)
            setError('The signature could not be extracted. Try turning off background removal.')
        })
        .finally(() => {
          if (!cancelled) setBusy(false)
        })
    }, 100)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [source, crop, removeBackground, onChange])
  return (
    <div className="grid gap-3">
      <label className="grid gap-2 text-sm">
        Signature image
        <input
          className="w-full min-w-0"
          type="file"
          aria-label="Signature image"
          accept="image/png,image/jpeg,image/webp"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            const token = ++generation.current
            onChange(null)
            setSource(null)
            setError(null)
            setBusy(true)
            try {
              const image = await importSignatureImage(file)
              if (generation.current !== token) return
              setCrop(fullSignatureCrop)
              setSource(image)
            } catch (error) {
              if (generation.current === token) {
                setError(error instanceof Error ? error.message : 'The image could not be opened.')
                setBusy(false)
              }
            }
          }}
        />
      </label>
      {source && (
        <>
          <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-md border bg-white">
            <img
              alt="Original signature image"
              src={originalPreview}
              className="max-h-40 max-w-full object-contain"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute border-2 border-sky-600 bg-sky-500/10"
              style={{
                left: `${crop.left}%`,
                top: `${crop.top}%`,
                width: `${crop.right - crop.left}%`,
                height: `${crop.bottom - crop.top}%`
              }}
            />
          </div>
          <fieldset className="grid min-w-0 grid-cols-2 gap-2">
            <legend className="mb-2 text-sm">Crop image (%)</legend>
            {(['left', 'top', 'right', 'bottom'] as const).map((edge) => (
              <label key={edge} className="flex items-center gap-2 text-sm capitalize">
                {edge}
                <input
                  type="number"
                  aria-label={`Crop ${edge}`}
                  className="w-14 min-w-0 rounded border px-1 py-1"
                  min={edge === 'right' ? crop.left + 1 : edge === 'bottom' ? crop.top + 1 : 0}
                  max={edge === 'left' ? crop.right - 1 : edge === 'top' ? crop.bottom - 1 : 100}
                  value={crop[edge]}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (value >= Number(event.target.min) && value <= Number(event.target.max)) {
                      onChange(null)
                      setBusy(true)
                      setCrop((current) => ({ ...current, [edge]: value }))
                    }
                  }}
                />
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={removeBackground}
              onChange={(event) => {
                onChange(null)
                setBusy(true)
                setRemoveBackground(event.target.checked)
              }}
            />
            Remove background
          </label>
        </>
      )}
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          Preparing signature…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
