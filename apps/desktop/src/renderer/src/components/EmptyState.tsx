import { motion } from 'framer-motion'
import { useReducedMotion } from '../hooks/useReducedMotion'
import {
  staggerContainer,
  staggerItem,
  staticVariants,
  suggestionHover,
} from '../utils/motion'

const SUGGESTIONS = [
  { text: 'Was steht heute in meinem Kalender?', icon: '📅' },
  { text: 'Fasse meine letzten E-Mails zusammen', icon: '📩' },
  { text: 'Erstelle eine neue Notiz', icon: '📝' },
  { text: 'Welche Dateien habe ich zuletzt bearbeitet?', icon: '📂' },
]

export default function EmptyState({
  onSuggestionClick,
}: {
  readonly onSuggestionClick: (text: string) => void
}): JSX.Element {
  const reduced = useReducedMotion()
  const container = reduced ? staticVariants : staggerContainer
  const item = reduced ? staticVariants : staggerItem

  return (
    <motion.div
      className="flex flex-col items-center justify-center px-4 py-16"
      variants={container}
      initial="initial"
      animate="animate"
    >
      {/* Logo */}
      <motion.div
        className="mb-2 text-4xl"
        initial={reduced ? undefined : { scale: 0, rotate: -90 }}
        animate={reduced ? undefined : { scale: 1, rotate: 0 }}
        transition={
          reduced
            ? undefined
            : { type: 'spring', stiffness: 260, damping: 20 }
        }
      >
        <span className="inline-block h-12 w-12 rounded-full bg-accent/12 text-center leading-[48px] text-2xl">
          ✦
        </span>
      </motion.div>

      {/* Greeting */}
      <motion.div variants={container} initial="initial" animate="animate">
        <motion.h2
          className="mb-1 text-xl font-semibold text-content text-center"
          variants={item}
        >
          Wie kann ich helfen?
        </motion.h2>
        <motion.p
          className="mb-8 text-sm text-content-muted text-center"
          variants={item}
        >
          Stell eine Frage, gib einen Auftrag, oder starte mit einem Vorschlag.
        </motion.p>
      </motion.div>

      {/* Suggestion cards */}
      <motion.div
        className="grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2"
        variants={container}
        initial="initial"
        animate="animate"
      >
        {SUGGESTIONS.map((s) => (
          <motion.button
            key={s.text}
            type="button"
            onClick={() => onSuggestionClick(s.text)}
            className="glass rounded-lg border border-edge px-4 py-3 text-left text-sm text-content-secondary transition-colors hover:border-edge-strong hover:text-content"
            variants={item}
            whileHover={reduced ? undefined : suggestionHover}
            whileTap={reduced ? undefined : { scale: 0.97 }}
          >
            <span className="mr-2">{s.icon}</span>
            {s.text}
          </motion.button>
        ))}
      </motion.div>
    </motion.div>
  )
}
