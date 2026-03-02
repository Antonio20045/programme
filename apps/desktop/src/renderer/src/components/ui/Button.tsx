import { motion, type HTMLMotionProps } from 'framer-motion'
import { cn } from '../../utils/cn'
import { useReducedMotion } from '../../hooks/useReducedMotion'

type ButtonProps = Omit<HTMLMotionProps<'button'>, 'ref'> & {
  readonly variant?: 'primary' | 'ghost' | 'danger' | 'success'
  readonly size?: 'sm' | 'md'
}

const variantStyles: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent text-surface font-medium hover:bg-accent-hover',
  ghost: 'bg-transparent text-content-secondary hover:bg-surface-hover hover:text-content',
  danger: 'bg-error/10 text-error border border-error/30 hover:bg-error/20',
  success: 'bg-success/80 text-content hover:bg-success',
}

const sizeStyles: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-md gap-1.5',
  md: 'px-4 py-2 text-sm rounded-lg gap-2',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  className,
  disabled,
  type = 'button',
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const reduced = useReducedMotion()

  return (
    <motion.button
      type={type}
      disabled={disabled}
      whileTap={reduced || disabled ? undefined : { scale: 0.97 }}
      className={cn(
        'inline-flex items-center justify-center transition-colors',
        variantStyles[variant],
        sizeStyles[size],
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  )
}
