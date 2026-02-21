import React from 'react'
import Markdown from 'react-native-marked'
import type { MarkdownProps } from 'react-native-marked'

type Styles = MarkdownProps['styles']

interface Props {
  readonly content: string
  readonly isDark: boolean
}

const lightTheme: Styles = {
  text: { color: '#333', fontSize: 16, lineHeight: 22 },
  codespan: { backgroundColor: '#f0f0f0', color: '#d63384', fontSize: 14 },
  code: { backgroundColor: '#f0f0f0', padding: 12, borderRadius: 8 },
  h1: { fontSize: 22, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  h2: { fontSize: 20, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  h3: { fontSize: 18, fontWeight: '600', color: '#1a1a2e', marginBottom: 8 },
  link: { color: '#4f8ef7' },
  li: { color: '#666' },
  blockquote: { borderLeftColor: '#4f8ef7', borderLeftWidth: 3, paddingLeft: 12 },
}

const darkTheme: Styles = {
  ...lightTheme,
  text: { color: '#e0e0e0', fontSize: 16, lineHeight: 22 },
  codespan: { backgroundColor: '#1a1a2e', color: '#f0a0c0', fontSize: 14 },
  code: { backgroundColor: '#1a1a2e', padding: 12, borderRadius: 8 },
  h1: { fontSize: 22, fontWeight: '700', color: '#e0e0e0', marginBottom: 8 },
  h2: { fontSize: 20, fontWeight: '700', color: '#e0e0e0', marginBottom: 8 },
  h3: { fontSize: 18, fontWeight: '600', color: '#e0e0e0', marginBottom: 8 },
  li: { color: '#aaa' },
}

export function MarkdownContent({ content, isDark }: Props): React.JSX.Element {
  if (!content) {
    return <></>
  }

  return <Markdown value={content} styles={isDark ? darkTheme : lightTheme} />
}
