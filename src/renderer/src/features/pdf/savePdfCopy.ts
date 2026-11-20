import type { PdfCopyDestination } from '../../../../shared/contracts'

export async function savePdfCopy(
  destination: PdfCopyDestination,
  generate: () => Promise<Uint8Array | 'print'>
): Promise<string | null> {
  const path = await window.lepis.choosePdfCopy(destination)
  if (!path) return null
  let output: Uint8Array | 'print' | null = null
  try {
    output = await generate()
  } finally {
    await window.lepis.finishPdfCopy(output)
  }
  return path
}
