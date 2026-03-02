import type { CSSProperties } from 'react'

/**
 * Warm-dark PrismJS theme for react-syntax-highlighter.
 * Mirrors the key structure of oneDark, colors mapped to app palette.
 */
const warmDark: Record<string, CSSProperties> = {
  // ── Base selectors ──────────────────────────────────────────────────
  'code[class*="language-"]': {
    color: '#ececf0',
    background: 'none',
    fontFamily:
      "'Geist Mono', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    wordWrap: 'normal',
    lineHeight: '1.5',
    MozTabSize: '2',
    OTabSize: '2',
    tabSize: '2',
    WebkitHyphens: 'none',
    MozHyphens: 'none',
    msHyphens: 'none',
    hyphens: 'none',
  },
  'pre[class*="language-"]': {
    color: '#ececf0',
    background: '#1c1c24',
    fontFamily:
      "'Geist Mono', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    wordWrap: 'normal',
    lineHeight: '1.5',
    MozTabSize: '2',
    OTabSize: '2',
    tabSize: '2',
    WebkitHyphens: 'none',
    MozHyphens: 'none',
    msHyphens: 'none',
    hyphens: 'none',
    padding: '1em',
    margin: '0.5em 0',
    overflow: 'auto',
    borderRadius: '0.3em',
  },

  // ── Selection ───────────────────────────────────────────────────────
  'code[class*="language-"]::-moz-selection': { background: '#32323e' },
  'code[class*="language-"] *::-moz-selection': { background: '#32323e' },
  'pre[class*="language-"] *::-moz-selection': { background: '#32323e' },
  'code[class*="language-"]::selection': { background: '#32323e' },
  'code[class*="language-"] *::selection': { background: '#32323e' },
  'pre[class*="language-"] *::selection': { background: '#32323e' },

  // ── Inline code ─────────────────────────────────────────────────────
  ':not(pre) > code[class*="language-"]': {
    background: '#1c1c24',
    padding: '0.1em 0.3em',
    borderRadius: '0.3em',
    whiteSpace: 'normal',
  },

  // ── Comments ────────────────────────────────────────────────────────
  comment: { color: '#6c6c80', fontStyle: 'italic' },
  prolog: { color: '#6c6c80', fontStyle: 'italic' },
  cdata: { color: '#6c6c80', fontStyle: 'italic' },
  doctype: { color: '#6c6c80', fontStyle: 'italic' },

  // ── Punctuation / Operators ─────────────────────────────────────────
  punctuation: { color: '#a0a0b0' },
  entity: { color: '#F0B060', cursor: 'help' },
  operator: { color: '#a0a0b0' },

  // ── Attr-names / Selectors / Properties / Tags ──────────────────────
  'attr-name': { color: '#F8CC88' },
  selector: { color: '#F8CC88' },
  property: { color: '#F8CC88' },
  tag: { color: '#F8CC88' },
  symbol: { color: '#F0B060' },
  atrule: { color: '#F0B060' },

  // ── Keywords / Builtins ─────────────────────────────────────────────
  keyword: { color: '#F0B060' },
  builtin: { color: '#F0B060' },

  // ── Strings / Inserted / Regex / Char ───────────────────────────────
  string: { color: '#3ecf8e' },
  char: { color: '#3ecf8e' },
  inserted: { color: '#3ecf8e' },
  regex: { color: '#3ecf8e' },
  'attr-value': { color: '#3ecf8e' },
  'attr-value > .token.punctuation': { color: '#3ecf8e' },

  // ── Numbers / Booleans / Constants / Class-name ─────────────────────
  number: { color: '#e8a44a' },
  boolean: { color: '#e8a44a' },
  constant: { color: '#e8a44a' },
  'class-name': { color: '#e8a44a' },

  // ── Functions ───────────────────────────────────────────────────────
  function: { color: '#f0f0f6' },
  url: { color: '#f0f0f6', textDecoration: 'underline' },

  // ── Variables ───────────────────────────────────────────────────────
  variable: { color: '#ececf0' },

  // ── Deleted / Important ─────────────────────────────────────────────
  deleted: { color: '#ef4444' },
  important: { color: '#ef4444', fontWeight: 'bold' },

  // ── Structural tokens ───────────────────────────────────────────────
  bold: { fontWeight: 'bold' },
  italic: { fontStyle: 'italic' },
  namespace: { opacity: 0.7 },

  // ── Attr-value punctuation ──────────────────────────────────────────
  'attr-value > .token.punctuation.attr-equals': { color: '#a0a0b0' },
  'special-attr > .token.attr-value > .token.value.css': { color: '#ececf0' },

  // ── Language-specific overrides ─────────────────────────────────────
  '.language-css .token.selector': { color: '#F8CC88' },
  '.language-css .token.property': { color: '#F8CC88' },
  '.language-css .token.function': { color: '#f0f0f6' },
  '.language-css .token.url > .token.function': { color: '#f0f0f6' },
  '.language-css .token.url > .token.string.url': { color: '#3ecf8e' },
  '.language-css .token.important': { color: '#ef4444' },
  '.language-css .token.atrule .token.rule': { color: '#F0B060' },

  '.language-javascript .token.operator': { color: '#a0a0b0' },
  '.language-javascript .token.template-string > .token.interpolation > .token.interpolation-punctuation.punctuation':
    { color: '#e8a44a' },

  '.language-json .token.operator': { color: '#a0a0b0' },
  '.language-json .token.null.keyword': { color: '#e8a44a' },

  '.language-markdown .token.url': { color: '#f0f0f6' },
  '.language-markdown .token.url > .token.operator': { color: '#a0a0b0' },
  '.language-markdown .token.url-reference.url > .token.string': { color: '#3ecf8e' },
  '.language-markdown .token.url > .token.content': { color: '#f0f0f6' },
  '.language-markdown .token.url > .token.url': { color: '#f0f0f6', textDecoration: 'underline' },
  '.language-markdown .token.url-reference.url': { color: '#f0f0f6' },
  '.language-markdown .token.blockquote.punctuation': { color: '#6c6c80', fontStyle: 'italic' },
  '.language-markdown .token.hr.punctuation': { color: '#6c6c80', fontStyle: 'italic' },
  '.language-markdown .token.code-snippet': { color: '#3ecf8e' },
  '.language-markdown .token.bold .token.content': { color: '#e8a44a' },
  '.language-markdown .token.italic .token.content': { color: '#F8CC88' },
  '.language-markdown .token.strike .token.content': { color: '#ef4444' },
  '.language-markdown .token.strike .token.punctuation': { color: '#ef4444' },
  '.language-markdown .token.list.punctuation': { color: '#F0B060' },
  '.language-markdown .token.title.important > .token.punctuation': { color: '#F0B060' },
}

export default warmDark
