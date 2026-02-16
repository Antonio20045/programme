import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ACTIONS_REQUIRING_CONFIRMATION,
  createFilesystemTool,
} from '../src/filesystem'
import type { ExtendedAgentTool } from '../src/types'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.join(CURRENT_DIR, '..', 'src', 'filesystem.ts')

let tmpDir: string
let tool: ExtendedAgentTool

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-tool-'))
  tool = createFilesystemTool({ allowedDirectories: [tmpDir] })
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ── Behavior Tests ─────────────────────────────────────────────

describe('readFile', () => {
  it('reads file content from allowed path', async () => {
    const filePath = path.join(tmpDir, 'test.txt')
    await fs.writeFile(filePath, 'hello world', 'utf-8')

    const result = await tool.execute({ action: 'readFile', path: filePath })

    expect(result.content[0]).toEqual({ type: 'text', text: 'hello world' })
  })

  it('throws for non-existent file', async () => {
    const filePath = path.join(tmpDir, 'nope.txt')

    await expect(
      tool.execute({ action: 'readFile', path: filePath }),
    ).rejects.toThrow()
  })
})

describe('writeFile', () => {
  it('writes file content correctly', async () => {
    const filePath = path.join(tmpDir, 'output.txt')

    await tool.execute({
      action: 'writeFile',
      path: filePath,
      content: 'written content',
    })

    const written = await fs.readFile(filePath, 'utf-8')
    expect(written).toBe('written content')
  })

  it('creates parent directories automatically', async () => {
    const filePath = path.join(tmpDir, 'sub', 'deep', 'file.txt')

    await tool.execute({
      action: 'writeFile',
      path: filePath,
      content: 'nested',
    })

    const written = await fs.readFile(filePath, 'utf-8')
    expect(written).toBe('nested')
  })
})

describe('searchFiles', () => {
  it('finds files matching query', async () => {
    await fs.writeFile(path.join(tmpDir, 'readme.md'), '', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'index.ts'), '', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'README.txt'), '', 'utf-8')

    const result = await tool.execute({
      action: 'searchFiles',
      query: 'readme',
      directory: tmpDir,
    })

    const text = result.content[0]
    expect(text).toBeDefined()
    if (text?.type === 'text') {
      expect(text.text).toContain('readme.md')
      expect(text.text).toContain('README.txt')
      expect(text.text).not.toContain('index.ts')
    }
  })

  it('searches subdirectories recursively', async () => {
    const subDir = path.join(tmpDir, 'nested')
    await fs.mkdir(subDir)
    await fs.writeFile(path.join(subDir, 'target.txt'), '', 'utf-8')

    const result = await tool.execute({
      action: 'searchFiles',
      query: 'target',
      directory: tmpDir,
    })

    const text = result.content[0]
    expect(text).toBeDefined()
    if (text?.type === 'text') {
      expect(text.text).toContain('target.txt')
    }
  })

  it('returns "No files found" when nothing matches', async () => {
    const result = await tool.execute({
      action: 'searchFiles',
      query: 'nonexistent',
      directory: tmpDir,
    })

    expect(result.content[0]).toEqual({ type: 'text', text: 'No files found' })
  })
})

describe('listDirectory', () => {
  it('lists directory contents', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.txt'), '', 'utf-8')
    await fs.mkdir(path.join(tmpDir, 'subdir'))

    const result = await tool.execute({
      action: 'listDirectory',
      path: tmpDir,
    })

    const text = result.content[0]
    expect(text).toBeDefined()
    if (text?.type === 'text') {
      expect(text.text).toContain('file.txt')
      expect(text.text).toContain('[DIR]')
      expect(text.text).toContain('subdir')
    }
  })

  it('returns "Empty directory" for empty dirs', async () => {
    const emptyDir = path.join(tmpDir, 'empty')
    await fs.mkdir(emptyDir)

    const result = await tool.execute({
      action: 'listDirectory',
      path: emptyDir,
    })

    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'Empty directory',
    })
  })
})

describe('moveFile', () => {
  it('moves a file within allowed directory', async () => {
    const src = path.join(tmpDir, 'source.txt')
    const dest = path.join(tmpDir, 'destination.txt')
    await fs.writeFile(src, 'move me', 'utf-8')

    await tool.execute({ action: 'moveFile', from: src, to: dest })

    await expect(fs.access(src)).rejects.toThrow()
    const content = await fs.readFile(dest, 'utf-8')
    expect(content).toBe('move me')
  })
})

describe('deleteFile', () => {
  it('deletes a file within allowed directory', async () => {
    const filePath = path.join(tmpDir, 'doomed.txt')
    await fs.writeFile(filePath, 'goodbye', 'utf-8')

    await tool.execute({ action: 'deleteFile', path: filePath })

    await expect(fs.access(filePath)).rejects.toThrow()
  })
})

// ── Argument Validation ────────────────────────────────────────

describe('argument validation', () => {
  it('rejects non-object args', async () => {
    await expect(tool.execute('string')).rejects.toThrow(
      'Arguments must be a non-null object',
    )
  })

  it('rejects null args', async () => {
    await expect(tool.execute(null)).rejects.toThrow(
      'Arguments must be a non-null object',
    )
  })

  it('rejects unknown action', async () => {
    await expect(
      tool.execute({ action: 'hackTheSystem' }),
    ).rejects.toThrow('Invalid action')
  })

  it('rejects missing path for readFile', async () => {
    await expect(tool.execute({ action: 'readFile' })).rejects.toThrow(
      'path is required',
    )
  })

  it('rejects missing content for writeFile', async () => {
    await expect(
      tool.execute({ action: 'writeFile', path: path.join(tmpDir, 'f.txt') }),
    ).rejects.toThrow('content is required')
  })
})

// ── Tool Metadata ──────────────────────────────────────────────

describe('tool metadata', () => {
  it('has correct name', () => {
    expect(tool.name).toBe('filesystem')
  })

  it('has correct permissions', () => {
    expect(tool.permissions).toEqual(['fs:read', 'fs:write'])
  })

  it('requires confirmation', () => {
    expect(tool.requiresConfirmation).toBe(true)
  })

  it('runs on desktop', () => {
    expect(tool.runsOn).toBe('desktop')
  })

  it('exports correct confirmation actions', () => {
    expect(ACTIONS_REQUIRING_CONFIRMATION.has('writeFile')).toBe(true)
    expect(ACTIONS_REQUIRING_CONFIRMATION.has('moveFile')).toBe(true)
    expect(ACTIONS_REQUIRING_CONFIRMATION.has('deleteFile')).toBe(true)
    expect(ACTIONS_REQUIRING_CONFIRMATION.has('readFile')).toBe(false)
    expect(ACTIONS_REQUIRING_CONFIRMATION.has('listDirectory')).toBe(false)
    expect(ACTIONS_REQUIRING_CONFIRMATION.has('searchFiles')).toBe(false)
  })

  it('requires at least one allowed directory', () => {
    expect(() =>
      createFilesystemTool({ allowedDirectories: [] }),
    ).toThrow('At least one allowed directory must be configured')
  })
})

// ── Path Traversal Protection (CRITICAL) ───────────────────────

describe('path traversal protection', () => {
  it('blocks ../../etc/passwd', async () => {
    await expect(
      tool.execute({
        action: 'readFile',
        path: path.join(tmpDir, '..', '..', 'etc', 'passwd'),
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks /etc/shadow', async () => {
    await expect(
      tool.execute({ action: 'readFile', path: '/etc/shadow' }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks symlink pointing outside allowed directories', async () => {
    const linkPath = path.join(tmpDir, 'evil-link')
    await fs.symlink('/etc', linkPath)

    await expect(
      tool.execute({
        action: 'readFile',
        path: path.join(linkPath, 'passwd'),
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks symlink to file outside allowed directories', async () => {
    const linkPath = path.join(tmpDir, 'sneaky-file')
    await fs.symlink('/etc/hosts', linkPath)

    await expect(
      tool.execute({ action: 'readFile', path: linkPath }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks path with null bytes', async () => {
    await expect(
      tool.execute({
        action: 'readFile',
        path: path.join(tmpDir, 'file\0.txt'),
      }),
    ).rejects.toThrow('null bytes')
  })

  it('blocks writeFile to traversal path', async () => {
    await expect(
      tool.execute({
        action: 'writeFile',
        path: path.join(tmpDir, '..', '..', 'tmp', 'evil.txt'),
        content: 'pwned',
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks moveFile destination outside allowed dirs', async () => {
    const src = path.join(tmpDir, 'legit.txt')
    await fs.writeFile(src, 'data', 'utf-8')

    await expect(
      tool.execute({
        action: 'moveFile',
        from: src,
        to: '/tmp/escaped.txt',
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks deleteFile outside allowed dirs', async () => {
    await expect(
      tool.execute({ action: 'deleteFile', path: '/etc/hosts' }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks searchFiles in directory outside allowed dirs', async () => {
    await expect(
      tool.execute({
        action: 'searchFiles',
        query: 'passwd',
        directory: '/etc',
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks listDirectory outside allowed dirs', async () => {
    await expect(
      tool.execute({ action: 'listDirectory', path: '/etc' }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('allows symlink within allowed directory', async () => {
    const realFile = path.join(tmpDir, 'real.txt')
    await fs.writeFile(realFile, 'safe content', 'utf-8')

    const linkPath = path.join(tmpDir, 'safe-link')
    await fs.symlink(realFile, linkPath)

    const result = await tool.execute({
      action: 'readFile',
      path: linkPath,
    })

    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'safe content',
    })
  })

  it('blocks writeFile via symlinked parent directory', async () => {
    const linkToEtc = path.join(tmpDir, 'symlinked-parent')
    await fs.symlink('/etc', linkToEtc)

    await expect(
      tool.execute({
        action: 'writeFile',
        path: path.join(linkToEtc, 'evil.conf'),
        content: 'pwned',
      }),
    ).rejects.toThrow('outside allowed directories')
  })
})

// ── Source Code Security ───────────────────────────────────────

describe('source code security', () => {
  it('contains no code execution patterns', async () => {
    const source = await fs.readFile(SOURCE_PATH, 'utf-8')
    assertNoEval(source)
  })

  it('contains no unauthorized fetch calls', async () => {
    const source = await fs.readFile(SOURCE_PATH, 'utf-8')
    assertNoUnauthorizedFetch(source, [])
  })
})
