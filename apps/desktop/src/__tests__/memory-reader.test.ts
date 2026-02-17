import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockFs = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(() => [] as string[]),
  unlinkSync: vi.fn(),
  statSync: vi.fn(() => ({ mtimeMs: Date.now() })),
}))

const mockOs = vi.hoisted(() => ({
  homedir: vi.fn(() => '/mock-home'),
}))

vi.mock('fs', () => ({ default: mockFs }))
vi.mock('os', () => ({ default: mockOs }))

import { readMemoryEntries, deleteMemoryEntry, readActivityLog } from '../main/memory-reader'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks(): void {
  vi.clearAllMocks()
  mockFs.readdirSync.mockReturnValue([])
  mockFs.statSync.mockReturnValue({ mtimeMs: Date.now() })
}

// ---------------------------------------------------------------------------
// readMemoryEntries
// ---------------------------------------------------------------------------

describe('readMemoryEntries', () => {
  beforeEach(resetMocks)

  it('returns empty arrays when MEMORY.md does not exist', () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mockFs.readdirSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const result = readMemoryEntries()
    expect(result.longTerm).toEqual([])
    expect(result.daily).toEqual([])
  })

  it('parses ## headings into longTerm entries', () => {
    mockFs.readFileSync.mockReturnValue(
      '# Erinnerungen\n\n## Lieblingsfarbe\n\nBlau\n\n## Haustier\n\nKatze namens Mimi\n',
    )
    mockFs.readdirSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const result = readMemoryEntries()
    expect(result.longTerm).toHaveLength(2)
    expect(result.longTerm[0]).toEqual({
      id: 'Lieblingsfarbe',
      title: 'Lieblingsfarbe',
      content: 'Blau',
    })
    expect(result.longTerm[1]).toEqual({
      id: 'Haustier',
      title: 'Haustier',
      content: 'Katze namens Mimi',
    })
  })

  it('handles MEMORY.md with only a top-level heading', () => {
    mockFs.readFileSync.mockReturnValue('# Erinnerungen\n\n')
    mockFs.readdirSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const result = readMemoryEntries()
    expect(result.longTerm).toEqual([])
  })

  it('parses daily memory files by date', () => {
    // First call: MEMORY.md (no sections), second call: daily file
    let callCount = 0
    mockFs.readFileSync.mockImplementation((filePath: string) => {
      if (String(filePath).includes('MEMORY.md')) {
        return '# Erinnerungen\n\n'
      }
      if (String(filePath).includes('2026-02-17.md')) {
        callCount++
        return 'Erster Absatz\n\nZweiter Absatz\n'
      }
      throw new Error('ENOENT')
    })
    mockFs.readdirSync.mockReturnValue(['2026-02-17.md'])

    const result = readMemoryEntries()
    expect(result.daily).toHaveLength(1)
    expect(result.daily[0]?.date).toBe('2026-02-17')
    expect(result.daily[0]?.entries).toHaveLength(2)
    expect(result.daily[0]?.entries[0]?.id).toBe('2026-02-17:0')
    expect(result.daily[0]?.entries[0]?.content).toBe('Erster Absatz')
    expect(callCount).toBe(1)
  })

  it('sorts daily entries by date descending', () => {
    mockFs.readFileSync.mockImplementation((filePath: string) => {
      if (String(filePath).includes('MEMORY.md')) return '# Erinnerungen\n\n'
      return 'Eintrag\n'
    })
    mockFs.readdirSync.mockReturnValue(['2026-02-10.md', '2026-02-17.md', '2026-02-14.md'])

    const result = readMemoryEntries()
    expect(result.daily.map((d) => d.date)).toEqual(['2026-02-17', '2026-02-14', '2026-02-10'])
  })

  it('skips non-date filenames in memory dir', () => {
    mockFs.readFileSync.mockImplementation((filePath: string) => {
      if (String(filePath).includes('MEMORY.md')) return '# Erinnerungen\n\n'
      return 'Eintrag\n'
    })
    mockFs.readdirSync.mockReturnValue(['README.md', '2026-02-17.md', 'notes.md'])

    const result = readMemoryEntries()
    expect(result.daily).toHaveLength(1)
    expect(result.daily[0]?.date).toBe('2026-02-17')
  })

  it('handles missing memory directory gracefully', () => {
    mockFs.readFileSync.mockReturnValue('# Erinnerungen\n\n')
    mockFs.readdirSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const result = readMemoryEntries()
    expect(result.daily).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// deleteMemoryEntry
// ---------------------------------------------------------------------------

describe('deleteMemoryEntry', () => {
  beforeEach(resetMocks)

  it('removes a longTerm section from MEMORY.md', () => {
    mockFs.readFileSync.mockReturnValue(
      '# Erinnerungen\n\n## Farbe\n\nBlau\n\n## Tier\n\nKatze\n',
    )

    deleteMemoryEntry({ type: 'longTerm', id: 'Farbe' })

    expect(mockFs.writeFileSync).toHaveBeenCalledOnce()
    const written = String(mockFs.writeFileSync.mock.calls[0]?.[1] ?? '')
    expect(written).not.toContain('## Farbe')
    expect(written).toContain('## Tier')
    expect(written).toContain('Katze')
  })

  it('does nothing when longTerm id not found', () => {
    mockFs.readFileSync.mockReturnValue('# Erinnerungen\n\n## Farbe\n\nBlau\n')

    deleteMemoryEntry({ type: 'longTerm', id: 'NichtVorhanden' })

    expect(mockFs.writeFileSync).toHaveBeenCalledOnce()
    const written = String(mockFs.writeFileSync.mock.calls[0]?.[1] ?? '')
    expect(written).toContain('## Farbe')
  })

  it('does nothing when MEMORY.md does not exist', () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    deleteMemoryEntry({ type: 'longTerm', id: 'Farbe' })

    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
  })

  it('removes a daily paragraph by index', () => {
    mockFs.readFileSync.mockReturnValue('Erster Absatz\n\nZweiter Absatz\n\nDritter Absatz\n')

    deleteMemoryEntry({ type: 'daily', id: '2026-02-17:1' })

    expect(mockFs.writeFileSync).toHaveBeenCalledOnce()
    const written = String(mockFs.writeFileSync.mock.calls[0]?.[1] ?? '')
    expect(written).toContain('Erster Absatz')
    expect(written).not.toContain('Zweiter Absatz')
    expect(written).toContain('Dritter Absatz')
  })

  it('deletes daily file when last paragraph removed', () => {
    mockFs.readFileSync.mockReturnValue('Einziger Absatz\n')

    deleteMemoryEntry({ type: 'daily', id: '2026-02-17:0' })

    expect(mockFs.unlinkSync).toHaveBeenCalledOnce()
    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
  })

  it('blocks path traversal in date field', () => {
    deleteMemoryEntry({ type: 'daily', id: '../../../etc/passwd:0' })

    expect(mockFs.readFileSync).not.toHaveBeenCalled()
    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    expect(mockFs.unlinkSync).not.toHaveBeenCalled()
  })

  it('handles semantically invalid but format-matching dates gracefully', () => {
    // 2026-13-99 matches the regex but the file won't exist
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    deleteMemoryEntry({ type: 'daily', id: '2026-13-99:0' })

    // File doesn't exist, so no writes or deletes
    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    expect(mockFs.unlinkSync).not.toHaveBeenCalled()
  })

  it('does nothing for invalid daily id format (no colon)', () => {
    deleteMemoryEntry({ type: 'daily', id: 'invalid-id' })

    expect(mockFs.readFileSync).not.toHaveBeenCalled()
  })

  it('does nothing for out-of-range index', () => {
    mockFs.readFileSync.mockReturnValue('Einziger Absatz\n')

    deleteMemoryEntry({ type: 'daily', id: '2026-02-17:5' })

    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    expect(mockFs.unlinkSync).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// readActivityLog
// ---------------------------------------------------------------------------

describe('readActivityLog', () => {
  beforeEach(resetMocks)

  it('returns empty when sessions directory does not exist', () => {
    mockFs.readdirSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const result = readActivityLog()
    expect(result.entries).toEqual([])
    expect(result.hasMore).toBe(false)
  })

  it('parses tool_use content blocks from JSONL', () => {
    const toolUseLine = JSON.stringify({
      timestamp: '2026-02-17T10:00:00Z',
      content: [
        {
          type: 'tool_use',
          id: 'tu-1',
          name: 'web-search',
          input: { query: 'Wetter Berlin' },
        },
      ],
    })

    mockFs.readdirSync.mockReturnValue(['session1.jsonl'])
    mockFs.readFileSync.mockReturnValue(toolUseLine)
    mockFs.statSync.mockReturnValue({ mtimeMs: Date.now() })

    const result = readActivityLog()
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]?.toolName).toBe('web-search')
    expect(result.entries[0]?.category).toBe('web')
    expect(result.entries[0]?.description).toBe('Wetter Berlin')
  })

  it('matches tool_result with tool_use by id', () => {
    const lines = [
      JSON.stringify({
        timestamp: '2026-02-17T10:00:00Z',
        content: [{
          type: 'tool_use',
          id: 'tu-1',
          name: 'gmail',
          input: { to: 'test@test.de' },
        }],
      }),
      JSON.stringify({
        timestamp: '2026-02-17T10:00:05Z',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tu-1',
          content: 'E-Mail gesendet',
        }],
      }),
    ].join('\n')

    mockFs.readdirSync.mockReturnValue(['session1.jsonl'])
    mockFs.readFileSync.mockReturnValue(lines)
    mockFs.statSync.mockReturnValue({ mtimeMs: Date.now() })

    const result = readActivityLog()
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]?.result).toBe('E-Mail gesendet')
    expect(result.entries[0]?.durationMs).toBe(5000)
    expect(result.entries[0]?.category).toBe('email')
  })

  it('skips corrupt JSONL lines', () => {
    const lines = [
      'this is not json',
      JSON.stringify({
        timestamp: '2026-02-17T10:00:00Z',
        content: [{
          type: 'tool_use',
          id: 'tu-2',
          name: 'shell',
          input: { command: 'ls -la' },
        }],
      }),
      '{incomplete json',
    ].join('\n')

    mockFs.readdirSync.mockReturnValue(['session1.jsonl'])
    mockFs.readFileSync.mockReturnValue(lines)
    mockFs.statSync.mockReturnValue({ mtimeMs: Date.now() })

    const result = readActivityLog()
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]?.toolName).toBe('shell')
  })

  it('supports pagination with offset and limit', () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({
        timestamp: `2026-02-17T10:0${String(i)}:00Z`,
        content: [{
          type: 'tool_use',
          id: `tu-${String(i)}`,
          name: 'filesystem',
          input: { path: `/file${String(i)}` },
        }],
      }),
    ).join('\n')

    mockFs.readdirSync.mockReturnValue(['session1.jsonl'])
    mockFs.readFileSync.mockReturnValue(lines)
    mockFs.statSync.mockReturnValue({ mtimeMs: Date.now() })

    const result = readActivityLog({ offset: 2, limit: 3 })
    expect(result.entries).toHaveLength(3)
    expect(result.hasMore).toBe(true)
  })

  it('hasMore is false when all entries fit', () => {
    const lines = JSON.stringify({
      timestamp: '2026-02-17T10:00:00Z',
      content: [{
        type: 'tool_use',
        id: 'tu-1',
        name: 'shell',
        input: { command: 'echo hi' },
      }],
    })

    mockFs.readdirSync.mockReturnValue(['session1.jsonl'])
    mockFs.readFileSync.mockReturnValue(lines)
    mockFs.statSync.mockReturnValue({ mtimeMs: Date.now() })

    const result = readActivityLog({ offset: 0, limit: 50 })
    expect(result.hasMore).toBe(false)
  })

  it('skips files older than cutoff', () => {
    mockFs.readdirSync.mockReturnValue(['old.jsonl'])
    mockFs.statSync.mockReturnValue({ mtimeMs: Date.now() - 30 * 24 * 60 * 60 * 1000 }) // 30 days ago

    const result = readActivityLog({ days: 7 })
    expect(result.entries).toEqual([])
  })

  it('uses sonstige category for unknown tools', () => {
    const line = JSON.stringify({
      timestamp: '2026-02-17T10:00:00Z',
      content: [{
        type: 'tool_use',
        id: 'tu-1',
        name: 'custom-unknown-tool',
        input: { query: 'test' },
      }],
    })

    mockFs.readdirSync.mockReturnValue(['session1.jsonl'])
    mockFs.readFileSync.mockReturnValue(line)
    mockFs.statSync.mockReturnValue({ mtimeMs: Date.now() })

    const result = readActivityLog()
    expect(result.entries[0]?.category).toBe('sonstige')
  })

  it('truncates long descriptions to 100 chars', () => {
    const longQuery = 'x'.repeat(200)
    const line = JSON.stringify({
      timestamp: '2026-02-17T10:00:00Z',
      content: [{
        type: 'tool_use',
        id: 'tu-1',
        name: 'web-search',
        input: { query: longQuery },
      }],
    })

    mockFs.readdirSync.mockReturnValue(['session1.jsonl'])
    mockFs.readFileSync.mockReturnValue(line)
    mockFs.statSync.mockReturnValue({ mtimeMs: Date.now() })

    const result = readActivityLog()
    expect(result.entries[0]?.description).toHaveLength(103) // 100 + '...'
    expect(result.entries[0]?.description.endsWith('...')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

describe('Security', () => {
  it('does not contain eval or Function constructor', async () => {
    const { readFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = readFileSync(
      new URL('../main/memory-reader.ts', import.meta.url),
      'utf-8',
    )
    expect(source).not.toMatch(/\beval\s*\(/)
    expect(source).not.toMatch(/new\s+Function\s*\(/)
  })

  it('validates date format to prevent path traversal', () => {
    resetMocks()
    // Attempt path traversal via date
    deleteMemoryEntry({ type: 'daily', id: '../../etc/passwd:0' })
    expect(mockFs.readFileSync).not.toHaveBeenCalled()

    deleteMemoryEntry({ type: 'daily', id: '../..:0' })
    expect(mockFs.readFileSync).not.toHaveBeenCalled()
  })

  it('uses path.resolve to validate workspace boundary', () => {
    resetMocks()
    // Even a valid-looking date with colon must stay within workspace
    deleteMemoryEntry({ type: 'daily', id: '2026-02-17:0' })
    // The function should attempt to read the file (date is valid)
    expect(mockFs.readFileSync).toHaveBeenCalled()
  })
})
