import { cn } from '../../utils/cn'
import type { HTMLAttributes } from 'react'

interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  readonly children: React.ReactNode
}

export default function ScrollArea({
  className,
  children,
  ...rest
}: ScrollAreaProps): JSX.Element {
  return (
    <div
      className={cn('overflow-y-auto scrollbar-thin', className)}
      {...rest}
    >
      {children}
    </div>
  )
}
