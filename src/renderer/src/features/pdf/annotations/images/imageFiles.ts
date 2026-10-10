import { SupportedImageMimeTypes } from 'pdfjs-dist/legacy/build/pdf.mjs'

export const supportedImageMimeTypes = SupportedImageMimeTypes

// Decode before creating an annotation so invalid files produce a visible error.
export async function validateImage(file: File): Promise<void> {
  if (!supportedImageMimeTypes.includes(file.type)) {
    throw new Error('Choose a supported image file, such as PNG, JPEG or WebP.')
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
  } catch {
    throw new Error('The image could not be opened.')
  } finally {
    URL.revokeObjectURL(url)
  }
}
