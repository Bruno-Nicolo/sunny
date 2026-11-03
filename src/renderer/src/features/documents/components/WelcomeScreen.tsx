import { useEffect, useState } from 'react'
import { FileText, LoaderCircle, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SuggestedPdf } from '../../../../../shared/contracts'

type Props = {
  onOpen(): void
  onOpenPath(path: string): Promise<void>
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'long',
  timeStyle: 'short'
})

function modifiedDate(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'
  today.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Yesterday'
  return dateFormatter.format(date)
}

export function WelcomeScreen({ onOpen, onOpenPath }: Props): React.JSX.Element {
  const [files, setFiles] = useState<SuggestedPdf[] | null>(null)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [opening, setOpening] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let loading = false
    const load = async (): Promise<void> => {
      if (loading) return
      loading = true
      try {
        const downloads = await window.lepis.listDownloadPdfs()
        if (active) {
          setFiles(downloads)
          setError(false)
        }
      } catch {
        if (active) setError(true)
      } finally {
        loading = false
      }
    }
    void load()
    window.addEventListener('focus', load)
    return () => {
      active = false
      window.removeEventListener('focus', load)
    }
  }, [refresh])

  const openFile = async (path: string): Promise<void> => {
    setOpening(path)
    try {
      await onOpenPath(path)
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="absolute inset-0 overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-full w-full max-w-[630px] flex-col justify-center px-10 py-20">
        <header className="mb-10 flex items-center justify-between gap-6">
          <h1 className="text-[23px] font-semibold tracking-tight">Sunny</h1>
          <Button variant="ghost" onClick={onOpen} className="-mr-2 gap-2.5 px-2 font-normal">
            <Plus className="size-4" aria-hidden="true" />
            Open PDF
          </Button>
        </header>

        <section aria-labelledby="welcome-downloads" aria-busy={files === null && !error}>
          <div className="mb-4 flex items-center justify-between gap-4 text-xs text-muted-foreground">
            <h2 id="welcome-downloads" className="font-medium">
              Downloads
            </h2>
            {files !== null && !error && (
              <span className="text-[11px]">
                {files.length} {files.length === 1 ? 'PDF' : 'PDFs'}
              </span>
            )}
          </div>
          <div className="border-t pt-2">
            {error ? (
              <div className="py-5 text-sm text-muted-foreground" role="status">
                <p>Downloads could not be read.</p>
                <Button
                  variant="link"
                  size="sm"
                  className="mt-1 px-0"
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  Try again
                </Button>
              </div>
            ) : files === null ? (
              <p className="py-5 text-sm text-muted-foreground" role="status">
                Looking for PDFs…
              </p>
            ) : files.length === 0 ? (
              <div className="py-5 text-sm text-muted-foreground" role="status">
                <p>No PDFs in Downloads yet.</p>
              </div>
            ) : (
              <ul className="-mx-2">
                {files.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-md px-2 py-3.5 text-left outline-none transition-colors hover:bg-muted/70 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                      title={file.path}
                      disabled={opening !== null}
                      onClick={() => void openFile(file.path)}
                    >
                      {opening === file.path ? (
                        <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <FileText className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[13px]">{file.name}</span>
                      <time
                        dateTime={new Date(file.mtimeMs).toISOString()}
                        title={fullDateFormatter.format(file.mtimeMs)}
                        className="shrink-0 text-right text-[11px] text-muted-foreground"
                      >
                        {modifiedDate(file.mtimeMs)}
                      </time>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
