import fs from 'fs'
import os from 'os'
import path from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryEntry {
  id: string
  title: string
  content: string
}

interface DailyMemory {
  date: string
  entries: Array<{ id: string; content: string }>
}

interface MemoryData {
  longTerm: MemoryEntry[]
  daily: DailyMemory[]
}

interface ActivityEntry {
  id: string
  toolName: string
  category: string
  description: string
  params: Record<string, unknown>
  result?: unknown
  timestamp: string
  durationMs?: number
}

interface ActivityData {
  entries: ActivityEntry[]
  hasMore: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKSPACE_DIR = path.join(os.homedir(), '.openclaw', 'workspace')
const AGENTS_DIR = path.join(os.homedir(), '.openclaw', 'agents')
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const CATEGORY_MAP: Record<string, string> = {
  gmail: 'email',
  calendar: 'kalender',
  filesystem: 'dateien',
  shell: 'shell',
  'web-search': 'web',
  browser: 'web',
  notes: 'notizen',
  memory: 'notizen',
  reminders: 'notizen',
}

// ---------------------------------------------------------------------------
// readMemoryEntries
// ---------------------------------------------------------------------------

export function readMemoryEntries(): MemoryData {
  const longTerm = parseLongTermMemory()
  const daily = parseDailyMemory()
  return { longTerm, daily }
}

function parseLongTermMemory(): MemoryEntry[] {
  const memoryPath = path.join(WORKSPACE_DIR, 'MEMORY.md')
  let content: string
  try {
    content = fs.readFileSync(memoryPath, 'utf-8')
  } catch {
    return []
  }

  const lines = content.split('\n')
  const entries: MemoryEntry[] = []
  let currentTitle = ''
  let currentLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentTitle !== '') {
        entries.push({
          id: currentTitle,
          title: currentTitle,
          content: currentLines.join('\n').trim(),
        })
      }
      currentTitle = line.slice(3).trim()
      currentLines = []
    } else if (currentTitle !== '') {
      currentLines.push(line)
    }
  }

  if (currentTitle !== '') {
    entries.push({
      id: currentTitle,
      title: currentTitle,
      content: currentLines.join('\n').trim(),
    })
  }

  return entries
}

function parseDailyMemory(): DailyMemory[] {
  const memoryDir = path.join(WORKSPACE_DIR, 'memory')
  let files: string[]
  try {
    files = fs.readdirSync(memoryDir)
  } catch {
    return []
  }

  const dailyEntries: DailyMemory[] = []

  for (const file of files) {
    if (!file.endsWith('.md')) continue
    const date = file.replace('.md', '')
    if (!DATE_PATTERN.test(date)) continue

    const filePath = path.join(memoryDir, file)
    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }

    const paragraphs = content
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)

    const entries = paragraphs.map((p, idx) => ({
      id: `${date}:${String(idx)}`,
      content: p,
    }))

    if (entries.length > 0) {
      dailyEntries.push({ date, entries })
    }
  }

  // Sort descending by date
  dailyEntries.sort((a, b) => b.date.localeCompare(a.date))

  return dailyEntries
}

// ---------------------------------------------------------------------------
// deleteMemoryEntry
// ---------------------------------------------------------------------------

export function deleteMemoryEntry(params: {
  type: 'longTerm' | 'daily'
  id: string
  date?: string
}): void {
  if (params.type === 'longTerm') {
    deleteLongTermEntry(params.id)
  } else {
    deleteDailyEntry(params.id)
  }
}

function deleteLongTermEntry(id: string): void {
  const memoryPath = path.join(WORKSPACE_DIR, 'MEMORY.md')
  let content: string
  try {
    content = fs.readFileSync(memoryPath, 'utf-8')
  } catch {
    return
  }

  const lines = content.split('\n')
  const resultLines: string[] = []
  let skipping = false

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (line.slice(3).trim() === id) {
        skipping = true
        continue
      }
      skipping = false
    }
    if (!skipping) {
      resultLines.push(line)
    }
  }

  fs.writeFileSync(memoryPath, resultLines.join('\n'), 'utf-8')
}

function deleteDailyEntry(id: string): void {
  const colonIndex = id.lastIndexOf(':')
  if (colonIndex === -1) return

  const date = id.slice(0, colonIndex)
  const indexStr = id.slice(colonIndex + 1)
  const index = Number(indexStr)
  if (!Number.isFinite(index) || index < 0) return

  // Security: validate date format against path traversal
  if (!DATE_PATTERN.test(date)) return

  const filePath = path.join(WORKSPACE_DIR, 'memory', `${date}.md`)

  // Security: verify resolved path stays within workspace
  const resolvedPath = path.resolve(filePath)
  if (!resolvedPath.startsWith(path.resolve(WORKSPACE_DIR))) return

  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return
  }

  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  if (index >= paragraphs.length) return

  paragraphs.splice(index, 1)

  if (paragraphs.length === 0) {
    fs.unlinkSync(filePath)
  } else {
    fs.writeFileSync(filePath, paragraphs.join('\n\n') + '\n', 'utf-8')
  }
}

// ---------------------------------------------------------------------------
// readActivityLog
// ---------------------------------------------------------------------------

export function readActivityLog(params?: {
  days?: number
  offset?: number
  limit?: number
}): ActivityData {
  const days = params?.days ?? 7
  const offset = params?.offset ?? 0
  const limit = params?.limit ?? 50

  const sessionsDir = path.join(AGENTS_DIR, 'sessions')
  let files: string[]
  try {
    files = fs.readdirSync(sessionsDir)
  } catch {
    return { entries: [], hasMore: false }
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const allEntries: ActivityEntry[] = []

  // Filter to .jsonl files and sort by modification time descending
  const jsonlFiles = files
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const fullPath = path.join(sessionsDir, f)
      try {
        const stat = fs.statSync(fullPath)
        return { name: f, path: fullPath, mtime: stat.mtimeMs }
      } catch {
        return null
      }
    })
    .filter((f): f is { name: string; path: string; mtime: number } => f !== null && f.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime)

  for (const file of jsonlFiles) {
    let content: string
    try {
      content = fs.readFileSync(file.path, 'utf-8')
    } catch {
      continue
    }

    const lines = content.split('\n').filter((l) => l.trim().length > 0)
    const toolUseMap = new Map<string, { entry: ActivityEntry; startTime: number }>()

    for (const line of lines) {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue // Skip corrupt lines
      }

      const contentBlocks = parsed['content']
      if (!Array.isArray(contentBlocks)) continue

      const timestamp = typeof parsed['timestamp'] === 'string' ? parsed['timestamp'] : ''

      for (const block of contentBlocks) {
        if (typeof block !== 'object' || block === null) continue
        const b = block as Record<string, unknown>

        if (b['type'] === 'tool_use') {
          const toolId = typeof b['id'] === 'string' ? b['id'] : ''
          const toolName = typeof b['name'] === 'string' ? b['name'] : 'unknown'
          const input = typeof b['input'] === 'object' && b['input'] !== null
            ? b['input'] as Record<string, unknown>
            : {}

          const description = extractDescription(input)
          const category = CATEGORY_MAP[toolName] ?? 'sonstige'

          const entry: ActivityEntry = {
            id: toolId !== '' ? toolId : `${file.name}:${String(allEntries.length)}`,
            toolName,
            category,
            description,
            params: input,
            timestamp,
          }

          toolUseMap.set(toolId, { entry, startTime: Date.parse(timestamp) || Date.now() })
          allEntries.push(entry)
        }

        if (b['type'] === 'tool_result') {
          const toolUseId = typeof b['tool_use_id'] === 'string' ? b['tool_use_id'] : ''
          const match = toolUseMap.get(toolUseId)
          if (match) {
            match.entry.result = b['content']
            const endTime = Date.parse(timestamp) || Date.now()
            if (match.startTime > 0 && endTime > match.startTime) {
              match.entry.durationMs = endTime - match.startTime
            }
          }
        }
      }
    }
  }

  // Sort by timestamp descending
  allEntries.sort((a, b) => {
    const ta = Date.parse(a.timestamp) || 0
    const tb = Date.parse(b.timestamp) || 0
    return tb - ta
  })

  const sliced = allEntries.slice(offset, offset + limit)
  const hasMore = offset + limit < allEntries.length

  return { entries: sliced, hasMore }
}

function extractDescription(input: Record<string, unknown>): string {
  const keys = ['query', 'path', 'command', 'subject', 'to', 'search', 'url', 'content', 'title']
  for (const key of keys) {
    const val = input[key]
    if (typeof val === 'string' && val.length > 0) {
      return val.length > 100 ? val.slice(0, 100) + '...' : val
    }
  }
  return ''
}
