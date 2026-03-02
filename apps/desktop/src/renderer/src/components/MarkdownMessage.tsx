import { useCallback, useState } from 'react'
import Markdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { motion, AnimatePresence } from 'framer-motion'
import type { Components } from 'react-markdown'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { cn } from '../utils/cn'
import warmDark from '../utils/syntax-theme'

function ClipboardIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5.5" y="2" width="5" height="3" rx="0.5" />
      <path d="M5.5 4H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-1.5" />
    </svg>
  )
}

function CheckIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  )
}

function CopyButton({ text }: { readonly text: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const reduced = useReducedMotion()

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => {
        setCopied(false)
      }, 2000)
    })
  }, [text])

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Kopiert' : 'Kopieren'}
      className={cn(
        'rounded p-1 transition-colors hover:bg-surface-hover',
        copied ? 'text-success' : 'text-content-secondary hover:text-content',
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <motion.span
            key="check"
            initial={reduced ? undefined : { opacity: 0, scale: 0.8 }}
            animate={reduced ? undefined : { opacity: 1, scale: 1 }}
            exit={reduced ? undefined : { opacity: 0, scale: 0.8 }}
            transition={reduced ? undefined : { duration: 0.15 }}
          >
            <CheckIcon />
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            initial={reduced ? undefined : { opacity: 0, scale: 0.8 }}
            animate={reduced ? undefined : { opacity: 1, scale: 1 }}
            exit={reduced ? undefined : { opacity: 0, scale: 0.8 }}
            transition={reduced ? undefined : { duration: 0.15 }}
          >
            <ClipboardIcon />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}

function MarkdownLink({
  href,
  children,
}: {
  readonly href?: string
  readonly children?: React.ReactNode
}): JSX.Element {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault()
      if (href) {
        void window.api.openExternal(href)
      }
    },
    [href],
  )

  return (
    <a
      href={href}
      onClick={handleClick}
      className="text-accent-text border-b border-transparent transition-colors hover:border-accent-text hover:text-accent"
    >
      {children}
    </a>
  )
}

const markdownComponents: Components = {
  code({ className, children }) {
    const match = (className ?? '').match(/language-(\w+)/)
    const codeString = String(children).replace(/\n$/, '')

    if (match) {
      const language = match[1] ?? 'text'
      return (
        <div className="group relative my-2 overflow-hidden rounded-lg border border-edge bg-surface transition-shadow hover:shadow-accent">
          <div className="flex items-center justify-between border-b border-edge bg-surface-alt px-4 py-1">
            <span className="text-xs uppercase tracking-wider text-content-muted">{language}</span>
            <CopyButton text={codeString} />
          </div>
          <SyntaxHighlighter
            style={warmDark}
            language={language}
            PreTag="div"
            customStyle={{
              margin: 0,
              background: 'transparent',
              padding: '0.75rem 1rem',
              fontSize: '0.8125rem',
            }}
          >
            {codeString}
          </SyntaxHighlighter>
        </div>
      )
    }

    return (
      <code className="rounded-md bg-surface-raised/60 px-1.5 py-0.5 font-mono text-[0.9em] text-accent-text">
        {children}
      </code>
    )
  },

  a({ href, children }) {
    return <MarkdownLink href={href}>{children}</MarkdownLink>
  },

  table({ children }) {
    return (
      <div className="my-2 overflow-x-auto rounded-lg border border-edge">
        <table className="w-full border-collapse text-sm">
          {children}
        </table>
      </div>
    )
  },

  thead({ children }) {
    return <thead className="bg-surface-alt">{children}</thead>
  },

  th({ children }) {
    return (
      <th className="border-b border-edge px-3 py-1.5 text-left text-xs font-medium uppercase tracking-wider text-content-secondary">
        {children}
      </th>
    )
  },

  td({ children }) {
    return (
      <td className="border-b border-edge px-3 py-1.5 text-content-secondary">
        {children}
      </td>
    )
  },

  tr({ children }) {
    return <tr className="even:bg-surface-raised/30">{children}</tr>
  },

  ul({ children }) {
    return <ul className="my-1 space-y-1.5 pl-5 list-disc marker:text-accent text-content-secondary">{children}</ul>
  },

  ol({ children }) {
    return <ol className="my-1 space-y-1.5 pl-5 list-decimal marker:text-accent marker:font-mono text-content-secondary">{children}</ol>
  },

  li({ children }) {
    return <li className="my-0">{children}</li>
  },

  p({ children }) {
    return <p className="my-1">{children}</p>
  },

  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l-2 border-edge-strong pl-3 text-content-secondary">
        {children}
      </blockquote>
    )
  },

  h1({ children }) {
    return <h1 className="my-2 text-xl font-bold">{children}</h1>
  },
  h2({ children }) {
    return <h2 className="my-2 text-lg font-bold">{children}</h2>
  },
  h3({ children }) {
    return <h3 className="my-1.5 text-base font-bold">{children}</h3>
  },
}

export default function MarkdownMessage({
  content,
}: {
  readonly content: string
}): JSX.Element {
  return (
    <div className="prose-invert max-w-none text-sm leading-relaxed text-content">
      <Markdown components={markdownComponents}>{content}</Markdown>
    </div>
  )
}
