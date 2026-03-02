import { motion, type HTMLMotionProps } from 'framer-motion'
import { cn } from '../../utils/cn'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useId } from 'react'

type InputProps = Omit<HTMLMotionProps<'input'>, 'ref'> & {
  readonly label?: string
  readonly error?: string
}

export default function Input({
  label,
  error,
  className,
  id: externalId,
  ...rest
}: InputProps): JSX.Element {
  const autoId = useId()
  const id = externalId ?? (label ? autoId : undefined)
  const reduced = useReducedMotion()

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-content-secondary">
          {label}
        </label>
      )}
      <motion.input
        id={id}
        whileFocus={reduced ? undefined : { boxShadow: 'var(--shadow-accent)' }}
        className={cn(
          'w-full rounded-lg border bg-surface-alt px-3 py-2 text-sm text-content',
          'placeholder:text-content-muted outline-none transition-colors',
          error ? 'border-error' : 'border-edge focus:border-accent',
          className,
        )}
        {...rest}
      />
      {error && (
        <p className="text-xs text-error">{error}</p>
      )}
    </div>
  )
}
