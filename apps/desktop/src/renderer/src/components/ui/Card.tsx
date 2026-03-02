import { motion, type HTMLMotionProps } from 'framer-motion'
import { cn } from '../../utils/cn'
import { useReducedMotion } from '../../hooks/useReducedMotion'

type CardProps = Omit<HTMLMotionProps<'div'>, 'ref'> & {
  readonly hover?: boolean
}

export default function Card({
  hover = true,
  className,
  children,
  ...rest
}: CardProps): JSX.Element {
  const reduced = useReducedMotion()

  return (
    <motion.div
      whileHover={
        hover && !reduced
          ? { y: -2, boxShadow: '0 8px 24px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)' }
          : undefined
      }
      className={cn(
        'rounded-xl border border-edge bg-surface-alt shadow-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </motion.div>
  )
}
