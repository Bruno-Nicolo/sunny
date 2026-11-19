import { SupportedImageMimeTypes } from 'pdfjs-dist/legacy/build/pdf.mjs'

// Decode before creating an annotation so invalid files produce a visible error.
export async function decodeImage(file: File): Promise<ImageBitmap> {
  if (!SupportedImageMimeTypes.includes(file.type)) {
    throw new Error('Choose a supported image file, such as PNG, JPEG or WebP.')
  }
  try {
    return await createImageBitmap(file)
  } catch {
    throw new Error('The image could not be opened.')
  }
}
