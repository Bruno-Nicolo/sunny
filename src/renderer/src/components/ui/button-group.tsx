import type { ComponentProps } from 'react'
import { cn } from 'cn'

function ButtonGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      className={cn(
        'flex w-fit items-center [&>[data-slot=button]:not(:first-child)]:rounded-l-none [&>[data-slot=button]:not(:last-child)]:rounded-r-none',
        className
      )}
      {...props}
    />
  )
}

export { ButtonGroup }
