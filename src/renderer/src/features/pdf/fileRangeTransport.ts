import { PDFDataRangeTransport } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PdfSource } from '../../../../shared/contracts'

// Request explicit ranges so opening cannot start an unnecessary whole-file download.
export class FileRangeTransport extends PDFDataRangeTransport {
  private readonly lifetime = new AbortController()

  constructor(
    private readonly source: Extract<PdfSource, { kind: 'file' }>,
    private readonly onError: (error: Error) => void
  ) {
    super(source.length, new Uint8Array(), true)
  }

  requestDataRange(begin: number, end: number): void {
    void fetch(this.source.url, {
      headers: { Range: `bytes=${begin}-${end - 1}` },
      signal: this.lifetime.signal
    })
      .then(async (response) => {
        if (response.status !== 206)
          throw new Error(`The PDF could not be read (${response.status}).`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.byteLength !== end - begin) throw new Error('The PDF range was incomplete.')
        if (!this.lifetime.signal.aborted) this.onDataRange(begin, bytes)
      })
      .catch((error) => {
        if (!this.lifetime.signal.aborted)
          this.onError(error instanceof Error ? error : new Error('The PDF could not be read.'))
      })
  }

  abort(): void {
    this.lifetime.abort()
  }
}
