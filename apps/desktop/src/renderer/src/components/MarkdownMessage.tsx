import { useCallback, useState } from 'react'
import Markdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { Components } from 'react-markdown'

function CopyButton({ text }: { readonly text: string }): JSX.Element {
  const [copied, setCopied] = useState(false)

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
      className="rounded px-2 py-0.5 text-xs text-content-secondary transition-colors hover:bg-surface-hover hover:text-content"
    >
      {copied ? 'Kopiert' : 'Kopieren'}
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
      className="text-accent-text underline hover:text-accent"
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
        <div className="group relative my-2 rounded-lg bg-surface">
          <div className="flex items-center justify-between border-b border-edge px-4 py-1">
            <span className="text-xs text-content-muted">{language}</span>
            <CopyButton text={codeString} />
          </div>
          <SyntaxHighlighter
            style={oneDark}
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
      <code className="rounded bg-surface-hover px-1.5 py-0.5 text-[0.8125rem] text-content">
        {children}
      </code>
    )
  },

  a({ href, children }) {
    return <MarkdownLink href={href}>{children}</MarkdownLink>
  },

  table({ children }) {
    return (
      <div className="my-2 overflow-x-auto">
        <table className="w-full border-collapse border border-edge text-sm">
          {children}
        </table>
      </div>
    )
  },

  thead({ children }) {
    return <thead className="bg-surface-raised">{children}</thead>
  },

  th({ children }) {
    return (
      <th className="border border-edge px-3 py-1.5 text-left font-medium text-content">
        {children}
      </th>
    )
  },

  td({ children }) {
    return (
      <td className="border border-edge px-3 py-1.5 text-content-secondary">
        {children}
      </td>
    )
  },

  tr({ children }) {
    return <tr className="even:bg-surface-raised/50">{children}</tr>
  },

  ul({ children }) {
    return <ul className="my-1 ml-4 list-disc text-content-secondary">{children}</ul>
  },

  ol({ children }) {
    return <ol className="my-1 ml-4 list-decimal text-content-secondary">{children}</ol>
  },

  li({ children }) {
    return <li className="my-0.5">{children}</li>
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
