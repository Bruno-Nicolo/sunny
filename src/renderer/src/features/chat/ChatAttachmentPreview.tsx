import type { ChatAttachment } from '../../../../shared/ai'

export function ChatAttachmentPreview({
  attachment
}: {
  attachment: ChatAttachment
}): React.JSX.Element {
  const label =
    attachment.kind === 'file'
      ? attachment.name
      : `Page ${attachment.page} · ${attachment.kind === 'text' ? 'Text' : 'Region'}`
  return (
    <>
      {attachment.image && (
        <img className="mb-1 max-h-20 w-full object-contain" src={attachment.image} alt={label} />
      )}
      <span className="block break-words" title={label}>
        {label}
      </span>
      {!attachment.image && (
        <span className="line-clamp-2 text-muted-foreground" title={attachment.text}>
          {attachment.text}
        </span>
      )}
    </>
  )
}
