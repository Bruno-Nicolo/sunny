import { memo } from 'react'

export type PageDragImage = { number: number; canvas: HTMLCanvasElement }

/** Display frozen thumbnails as a fan while their original cells are removed from the grid. */
export const PageDragPreview = memo(function PageDragPreview({
  count,
  images
}: {
  count: number
  images: PageDragImage[]
}): React.JSX.Element {
  const center = (images.length - 1) / 2
  const pageCount = `${count} ${count === 1 ? 'page' : 'pages'}`
  return (
    <div role="group" aria-label={`Moving ${pageCount}`} className="relative h-[240px] w-[174px]">
      {images.map(({ number, canvas: image }, index) => (
        <div
          key={number}
          className="absolute inset-0 flex flex-col items-center gap-2 rounded-xl border bg-background p-3 text-xs shadow-lg"
          style={{
            transform: `translate(${(index - center) * 6}px, ${Math.abs(index - center) * 2}px) rotate(${(index - center) * 12}deg)`,
            transformOrigin: '50% 90%',
            zIndex: index + 1
          }}
        >
          <canvas
            ref={(canvas) => {
              if (!canvas) return
              canvas.width = image.width
              canvas.height = image.height
              canvas.getContext('2d')?.drawImage(image, 0, 0)
            }}
            className="h-[194px] w-[150px] border bg-white object-contain"
            aria-hidden="true"
          />
          <span>{number}</span>
        </div>
      ))}
      <span className="absolute -top-2 -right-2 z-10 rounded-full bg-primary px-2 py-1 text-xs text-primary-foreground shadow">
        {pageCount}
      </span>
    </div>
  )
})
