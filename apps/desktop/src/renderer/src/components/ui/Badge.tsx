import { cn } from '../../utils/cn'

interface BadgeProps {
  readonly variant?: 'default' | 'success' | 'warning' | 'error' | 'accent'
  readonly children: React.ReactNode
  readonly className?: string
}

const variantStyles: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-surface-hover text-content-secondary border-edge',
  success: 'bg-success/10 text-success border-success/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  error: 'bg-error/10 text-error border-error/30',
  accent: 'bg-accent-muted text-accent-text border-accent/30',
}

export default function Badge({
  variant = 'default',
  children,
  className,
}: BadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
