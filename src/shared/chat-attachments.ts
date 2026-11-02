import type { ChatAttachment } from './ai'

export const maxAttachments = 12
export const maxAttachmentCharacters = 32_000
export const maxAttachmentBytes = 6 * 1024 * 1024

export function validateAttachments(attachments: ChatAttachment[]): void {
  if (!Array.isArray(attachments) || attachments.length > maxAttachments)
    throw new Error(`Attach at most ${maxAttachments} attachments per message.`)
  for (const attachment of attachments) {
    if (
      !/^a_[a-zA-Z0-9_-]+$/.test(attachment.id) ||
      !['text', 'region', 'file'].includes(attachment.kind) ||
      typeof attachment.text !== 'string' ||
      (attachment.kind === 'file'
        ? typeof attachment.name !== 'string' ||
          !attachment.name.trim() ||
          attachment.name.length > 255 ||
          (!attachment.text.trim() && !attachment.image)
        : !Number.isInteger(attachment.page) ||
          attachment.page < 1 ||
          !Array.isArray(attachment.rects) ||
          !attachment.rects.length ||
          attachment.rects.length > 1000 ||
          attachment.rects.some(
            (rect) =>
              !Array.isArray(rect) ||
              rect.length !== 4 ||
              rect.some((value) => !Number.isFinite(value))
          ))
    )
      throw new Error('Invalid attachment.')
    if (attachment.image && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(attachment.image))
      throw new Error('Invalid attachment image.')
    if (attachment.kind === 'region' && !attachment.image)
      throw new Error('The selected region has no image.')
  }
  validateAttachmentBudget(attachments)
}

/** Check aggregate limits without rescanning already validated image data. */
export function validateAttachmentBudget(attachments: ChatAttachment[]): void {
  if (attachments.length > maxAttachments)
    throw new Error(`Attach at most ${maxAttachments} attachments per message.`)
  let imageBytes = 0
  let characters = 0
  for (const attachment of attachments) {
    characters += attachment.text.length
    if (attachment.image)
      imageBytes += Math.ceil((attachment.image.length - 'data:image/png;base64,'.length) * 0.75)
  }
  if (imageBytes > maxAttachmentBytes || characters > maxAttachmentCharacters)
    throw new Error(
      'These attachments exceed the message budget. Remove some attachments before sending.'
    )
}
