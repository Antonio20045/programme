/**
 * Archive tool — create, extract, and list ZIP archives.
 * Factory pattern with configurable allowed directories.
 *
 * Dependencies: archiver (create), yauzl (read/extract).
 */

import archiver from 'archiver'
import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { pipeline } from 'node:stream/promises'
import * as yauzl from 'yauzl'
import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateArgs {
  readonly action: 'create'
  readonly output: string
  readonly sources: readonly string[]
}

interface ExtractArgs {
  readonly action: 'extract'
  readonly archive: string
  readonly destination: string
}

interface ListArgs {
  readonly action: 'list'
  readonly archive: string
}

type ArchiveArgs = CreateArgs | ExtractArgs | ListArgs

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ArchiveConfig {
  readonly allowedDirectories: readonly string[]
}

const DEFAULT_ALLOWED: readonly string[] = [
  path.join(os.homedir(), '.openclaw', 'workspace'),
]

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ARCHIVE_SIZE = 100 * 1024 * 1024        // 100 MB
const MAX_FILES = 10_000
const MAX_EXTRACTED_SIZE = 500 * 1024 * 1024       // 500 MB
const MAX_COMPRESSION_RATIO = 100

// ---------------------------------------------------------------------------
// Path validation (same pattern as filesystem.ts)
// ---------------------------------------------------------------------------

function assertNoNullBytes(p: string): void {
  if (p.includes('\0')) {
    throw new Error('Path contains null bytes')
  }
}

async function resolveReal(target: string): Promise<string> {
  try {
    return await fsPromises.realpath(target)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    const parent = path.dirname(target)
    if (parent === target) return target
    const resolvedParent = await resolveReal(parent)
    return path.join(resolvedParent, path.basename(target))
  }
}

async function validatePath(
  inputPath: string,
  allowedDirs: readonly string[],
): Promise<string> {
  assertNoNullBytes(inputPath)
  const resolved = path.resolve(inputPath)
  const real = await resolveReal(resolved)
  const realAllowedDirs = await Promise.all(allowedDirs.map(resolveReal))

  const isAllowed = realAllowedDirs.some(
    (dir) => real === dir || real.startsWith(dir + path.sep),
  )

  if (!isAllowed) {
    throw new Error('Access denied: path is outside allowed directories')
  }

  return real
}

/**
 * Zip Slip protection: ensures an extracted entry path stays within the target directory.
 */
function isWithinDir(entryPath: string, targetDir: string): boolean {
  const resolved = path.resolve(targetDir, entryPath)
  return resolved === targetDir || resolved.startsWith(targetDir + path.sep)
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): ArchiveArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'create') {
    const output = obj['output']
    if (typeof output !== 'string' || output.trim() === '') {
      throw new Error('create requires a non-empty "output" path')
    }
    const sources = obj['sources']
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new Error('create requires a non-empty "sources" array')
    }
    for (const src of sources) {
      if (typeof src !== 'string' || src.trim() === '') {
        throw new Error('Each source must be a non-empty string')
      }
    }
    return { action: 'create', output: output.trim(), sources: sources as string[] }
  }

  if (action === 'extract') {
    const archive = obj['archive']
    const destination = obj['destination']
    if (typeof archive !== 'string' || archive.trim() === '') {
      throw new Error('extract requires a non-empty "archive" path')
    }
    if (typeof destination !== 'string' || destination.trim() === '') {
      throw new Error('extract requires a non-empty "destination" path')
    }
    return { action: 'extract', archive: archive.trim(), destination: destination.trim() }
  }

  if (action === 'list') {
    const archive = obj['archive']
    if (typeof archive !== 'string' || archive.trim() === '') {
      throw new Error('list requires a non-empty "archive" path')
    }
    return { action: 'list', archive: archive.trim() }
  }

  throw new Error('action must be "create", "extract", or "list"')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

// Promisified yauzl.open
function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err)
      if (!zipfile) return reject(new Error('Failed to open ZIP file'))
      resolve(zipfile)
    })
  })
}

// Read all entries from a zip file
function readEntries(zipfile: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = []
    zipfile.on('entry', (entry: yauzl.Entry) => {
      entries.push(entry)
      zipfile.readEntry()
    })
    zipfile.on('end', () => resolve(entries))
    zipfile.on('error', reject)
    zipfile.readEntry()
  })
}

// Open read stream for an entry
function openReadStream(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) return reject(err)
      if (!stream) return reject(new Error('No stream returned'))
      resolve(stream)
    })
  })
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createArchiveTool(config?: ArchiveConfig): ExtendedAgentTool {
  const allowedDirs = (config?.allowedDirectories ?? DEFAULT_ALLOWED).map(
    (d) => path.resolve(d),
  )

  if (allowedDirs.length === 0) {
    throw new Error('At least one allowed directory must be configured')
  }

  return {
    name: 'archive',
    description:
      'Create, extract, and list ZIP archives within allowed directories. ' +
      'All actions require user confirmation. Supports Zip Slip protection and size limits.',
    parameters: PARAMETERS,
    permissions: ['fs:read', 'fs:write'],
    requiresConfirmation: true,
    defaultRiskTier: 2,
    riskTiers: { list: 1, create: 2, extract: 2 },
    runsOn: 'server',

    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)

      switch (parsed.action) {
        case 'create': {
          const outputPath = await validatePath(parsed.output, allowedDirs)

          // Validate all sources
          const safeSources: string[] = []
          for (const src of parsed.sources) {
            safeSources.push(await validatePath(src, allowedDirs))
          }

          const output = fs.createWriteStream(outputPath)
          const archive = archiver('zip', { zlib: { level: 9 } })

          const pipelinePromise = pipeline(archive, output)

          let fileCount = 0
          for (const src of safeSources) {
            const stat = await fsPromises.stat(src)
            if (stat.isDirectory()) {
              archive.directory(src, path.basename(src))
            } else {
              archive.file(src, { name: path.basename(src) })
              fileCount++
              if (fileCount > MAX_FILES) {
                archive.abort()
                throw new Error(`Too many files (max ${String(MAX_FILES)})`)
              }
            }
          }

          await archive.finalize()
          await pipelinePromise

          const outputStat = await fsPromises.stat(outputPath)
          if (outputStat.size > MAX_ARCHIVE_SIZE) {
            await fsPromises.unlink(outputPath)
            throw new Error(`Archive too large (${String(outputStat.size)} bytes, max ${String(MAX_ARCHIVE_SIZE)})`)
          }

          return textResult(JSON.stringify({
            created: true,
            path: outputPath,
            size: outputStat.size,
          }))
        }

        case 'extract': {
          const archivePath = await validatePath(parsed.archive, allowedDirs)
          const destPath = await validatePath(parsed.destination, allowedDirs)

          // Check archive size
          const archiveStat = await fsPromises.stat(archivePath)
          if (archiveStat.size > MAX_ARCHIVE_SIZE) {
            throw new Error(`Archive too large (${String(archiveStat.size)} bytes, max ${String(MAX_ARCHIVE_SIZE)})`)
          }

          const zipfile = await openZip(archivePath)
          const entries = await readEntries(zipfile)

          if (entries.length > MAX_FILES) {
            throw new Error(`Too many entries (${String(entries.length)}, max ${String(MAX_FILES)})`)
          }

          await fsPromises.mkdir(destPath, { recursive: true })

          let totalExtracted = 0
          let extractedCount = 0

          // Re-open for extraction (entries consumed the first open)
          const zipfile2 = await openZip(archivePath)

          await new Promise<void>((resolve, reject) => {
            zipfile2.on('entry', (entry: yauzl.Entry) => {
              const fileName = entry.fileName

              // Zip Slip check
              if (!isWithinDir(fileName, destPath)) {
                zipfile2.close()
                reject(new Error(`Zip Slip detected: "${fileName}" escapes target directory`))
                return
              }

              // Skip symlinks (entry has externalFileAttributes)
              // Directories end with /
              if (fileName.endsWith('/')) {
                fsPromises.mkdir(path.resolve(destPath, fileName), { recursive: true })
                  .then(() => zipfile2.readEntry())
                  .catch(reject)
                return
              }

              // Compression ratio check
              if (entry.compressedSize > 0) {
                const ratio = entry.uncompressedSize / entry.compressedSize
                if (ratio > MAX_COMPRESSION_RATIO) {
                  zipfile2.close()
                  reject(new Error(`Compression ratio too high (${String(Math.round(ratio))}:1, max ${String(MAX_COMPRESSION_RATIO)}:1) — possible zip bomb`))
                  return
                }
              }

              totalExtracted += entry.uncompressedSize
              if (totalExtracted > MAX_EXTRACTED_SIZE) {
                zipfile2.close()
                reject(new Error(`Extracted size exceeds limit (${String(MAX_EXTRACTED_SIZE)} bytes)`))
                return
              }

              const fullPath = path.resolve(destPath, fileName)
              const dir = path.dirname(fullPath)

              fsPromises.mkdir(dir, { recursive: true })
                .then(() => openReadStream(zipfile2, entry))
                .then((readStream) => {
                  const writeStream = fs.createWriteStream(fullPath)
                  readStream.pipe(writeStream)
                  writeStream.on('finish', () => {
                    extractedCount++
                    zipfile2.readEntry()
                  })
                  writeStream.on('error', reject)
                })
                .catch(reject)
            })

            zipfile2.on('end', () => resolve())
            zipfile2.on('error', reject)
            zipfile2.readEntry()
          })

          return textResult(JSON.stringify({
            extracted: true,
            destination: destPath,
            files: extractedCount,
            totalSize: totalExtracted,
          }))
        }

        case 'list': {
          const archivePath = await validatePath(parsed.archive, allowedDirs)

          const archiveStat = await fsPromises.stat(archivePath)
          if (archiveStat.size > MAX_ARCHIVE_SIZE) {
            throw new Error(`Archive too large (${String(archiveStat.size)} bytes, max ${String(MAX_ARCHIVE_SIZE)})`)
          }

          const zipfile = await openZip(archivePath)
          const entries = await readEntries(zipfile)

          const files = entries.map((entry) => ({
            path: entry.fileName,
            size: entry.uncompressedSize,
            compressedSize: entry.compressedSize,
            isDirectory: entry.fileName.endsWith('/'),
          }))

          return textResult(JSON.stringify({
            archive: archivePath,
            entries: files,
            count: files.length,
            totalSize: files.reduce((sum, f) => sum + f.size, 0),
          }))
        }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const PARAMETERS: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action: "create", "extract", or "list"',
      enum: ['create', 'extract', 'list'],
    },
    output: {
      type: 'string',
      description: 'Output ZIP file path (create)',
    },
    sources: {
      type: 'array',
      description: 'Files/directories to archive (create)',
      items: { type: 'string' },
    },
    archive: {
      type: 'string',
      description: 'ZIP file path to read (extract, list)',
    },
    destination: {
      type: 'string',
      description: 'Directory to extract to (extract)',
    },
  },
  required: ['action'],
}

// ---------------------------------------------------------------------------
// Default instance
// ---------------------------------------------------------------------------

export const archiveTool: ExtendedAgentTool = createArchiveTool()

export { parseArgs, isWithinDir, validatePath }
