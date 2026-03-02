import type { Variants } from 'framer-motion'

/** Route transitions: crossfade + subtle Y-shift (150ms). */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
}
export const pageTransition = { duration: 0.15, ease: 'easeOut' as const }

/** Session items: slide-in from top, slide-out to left (150ms). */
export const sessionItemVariants: Variants = {
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: -20 },
}
export const sessionItemTransition = { duration: 0.15, ease: 'easeOut' as const }

/** Reduced-motion fallback: no animations. */
export const staticVariants: Variants = {
  initial: {},
  animate: {},
  exit: {},
}

/** Message bubble: spring from below, enter only (messages don't exit). */
export const messageVariants: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
}
export const messageTransition = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
}

/** Stagger container: orchestrates children entrance. */
export const staggerContainer: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.06 } },
}

/** Stagger child item: fade + slide up. */
export const staggerItem: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
}

/** Suggestion card hover: subtle lift with spring. */
export const suggestionHover = {
  y: -3,
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
}

/** Typing indicator dot: staggered y-bounce, repeating. */
export const typingDotVariants: Variants = {
  initial: { y: 0 },
  animate: { y: [0, -6, 0] },
}
export const typingDotTransition = (i: number): Record<string, unknown> => ({
  duration: 0.6,
  repeat: Infinity,
  ease: 'easeInOut' as const,
  delay: i * 0.15,
})

/** File preview item: scale entrance/exit. */
export const fileItemVariants: Variants = {
  initial: { opacity: 0, scale: 0.85 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.85 },
}

/** Expand/collapse: height 0 ↔ auto (für Phase 3c ToolConfirmation). */
export const expandVariants: Variants = {
  collapsed: { height: 0, opacity: 0, overflow: 'hidden' as const },
  expanded: { height: 'auto', opacity: 1, overflow: 'visible' as const },
}
export const expandTransition = { duration: 0.2, ease: 'easeOut' as const }

/** Overlay backdrop: fade in/out (150ms). */
export const overlayVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
}
export const overlayTransition = { duration: 0.15, ease: 'easeOut' as const }

/** Command palette panel: spring entrance with scale + y-shift. */
export const paletteVariants: Variants = {
  initial: { opacity: 0, scale: 0.95, y: -10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: -10 },
}
export const paletteTransition = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
}

/** Notification: slide from top + fade, exit upward. */
export const notificationVariants: Variants = {
  initial: { opacity: 0, y: -20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
}
export const notificationTransition = { duration: 0.2, ease: 'easeOut' as const }
