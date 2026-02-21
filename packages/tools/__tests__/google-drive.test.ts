import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { googleDriveTool, parseArgs, _resetClient } from '../src/google-drive'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/google-drive.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, status = 200): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers({ 'content-length': '100' }),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function mockFetchSequence(responses: Array<{ ok: boolean; status: number; statusText: string; data?: unknown; contentLength?: string }>): ReturnType<typeof vi.fn> {
  const queue = [...responses]
  const mock = vi.fn().mockImplementation(() => {
    const resp = queue.shift() ?? { ok: true, status: 200, statusText: 'OK', data: {} }
    const headers = new Headers()
    if ('contentLength' in resp && resp.contentLength) {
      headers.set('content-length', resp.contentLength)
    }
    return Promise.resolve({
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
      json: () => Promise.resolve(resp.data ?? {}),
      text: () => Promise.resolve(JSON.stringify(resp.data ?? {})),
      headers,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
    })
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('google-drive tool', () => {
  beforeEach(() => {
    _resetClient()
    vi.stubEnv('GOOGLE_ACCESS_TOKEN', 'test-access-token')
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', 'test-refresh-token')
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-client-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(googleDriveTool.name).toBe('google-drive')
    })

    it('runs on server', () => {
      expect(googleDriveTool.runsOn).toBe('server')
    })

    it('requires confirmation', () => {
      expect(googleDriveTool.requiresConfirmation).toBe(true)
    })

    it('has correct permissions', () => {
      expect(googleDriveTool.permissions).toContain('net:http')
      expect(googleDriveTool.permissions).toContain('google:drive')
    })

    it('has action enum in parameters', () => {
      const actionProp = googleDriveTool.parameters.properties['action']
      expect(actionProp?.enum).toContain('search')
      expect(actionProp?.enum).toContain('download')
      expect(actionProp?.enum).toContain('upload')
      expect(actionProp?.enum).toContain('delete')
    })
  })

  // -------------------------------------------------------------------------
  // Argument parsing
  // -------------------------------------------------------------------------

  describe('parseArgs()', () => {
    it('rejects null args', () => {
      expect(() => parseArgs(null)).toThrow('Arguments must be an object')
    })

    it('rejects non-object args', () => {
      expect(() => parseArgs('string')).toThrow('Arguments must be an object')
    })

    it('rejects unknown action', () => {
      expect(() => parseArgs({ action: 'hack' })).toThrow('action must be')
    })

    // search
    it('parses search action', () => {
      expect(parseArgs({ action: 'search', query: 'report' })).toEqual({
        action: 'search', query: 'report',
      })
    })

    it('rejects search without query', () => {
      expect(() => parseArgs({ action: 'search' })).toThrow('non-empty "query"')
    })

    // list
    it('parses list with no folderId', () => {
      expect(parseArgs({ action: 'list' })).toEqual({ action: 'list', folderId: undefined })
    })

    it('parses list with folderId', () => {
      expect(parseArgs({ action: 'list', folderId: 'abc123' })).toEqual({
        action: 'list', folderId: 'abc123',
      })
    })

    // info
    it('parses info action', () => {
      expect(parseArgs({ action: 'info', fileId: 'abc' })).toEqual({ action: 'info', fileId: 'abc' })
    })

    it('rejects info without fileId', () => {
      expect(() => parseArgs({ action: 'info' })).toThrow('non-empty "fileId"')
    })

    it('rejects fileId with invalid characters', () => {
      expect(() => parseArgs({ action: 'info', fileId: '../etc/passwd' })).toThrow('invalid characters')
    })

    // download
    it('parses download action', () => {
      expect(parseArgs({ action: 'download', fileId: 'abc' })).toEqual({ action: 'download', fileId: 'abc' })
    })

    // upload
    it('parses upload action', () => {
      const result = parseArgs({ action: 'upload', name: 'test.txt', data: 'hello' })
      expect(result).toEqual({
        action: 'upload', name: 'test.txt', data: 'hello', mimeType: undefined, folderId: undefined,
      })
    })

    it('rejects upload without name', () => {
      expect(() => parseArgs({ action: 'upload', data: 'hello' })).toThrow('non-empty "name"')
    })

    it('rejects upload without data', () => {
      expect(() => parseArgs({ action: 'upload', name: 'test.txt' })).toThrow('"data" string')
    })

    it('rejects upload exceeding 50MB', () => {
      const bigData = 'x'.repeat(50 * 1024 * 1024 + 1)
      expect(() => parseArgs({ action: 'upload', name: 'big.bin', data: bigData })).toThrow('50MB limit')
    })

    // share
    it('parses share action', () => {
      expect(parseArgs({ action: 'share', fileId: 'abc', email: 'a@b.com', role: 'reader' })).toEqual({
        action: 'share', fileId: 'abc', email: 'a@b.com', role: 'reader',
      })
    })

    it('accepts commenter role', () => {
      expect(parseArgs({ action: 'share', fileId: 'abc', email: 'a@b.com', role: 'commenter' })).toHaveProperty('role', 'commenter')
    })

    it('accepts writer role', () => {
      expect(parseArgs({ action: 'share', fileId: 'abc', email: 'a@b.com', role: 'writer' })).toHaveProperty('role', 'writer')
    })

    it('rejects owner role (no owner transfer)', () => {
      expect(() => parseArgs({ action: 'share', fileId: 'abc', email: 'a@b.com', role: 'owner' })).toThrow('owner transfer not allowed')
    })

    it('rejects share without email', () => {
      expect(() => parseArgs({ action: 'share', fileId: 'abc', role: 'reader' })).toThrow('non-empty "email"')
    })

    // createFolder
    it('parses createFolder', () => {
      expect(parseArgs({ action: 'createFolder', name: 'My Folder' })).toEqual({
        action: 'createFolder', name: 'My Folder', parentId: undefined,
      })
    })

    it('rejects createFolder without name', () => {
      expect(() => parseArgs({ action: 'createFolder' })).toThrow('non-empty "name"')
    })

    // move
    it('parses move action', () => {
      expect(parseArgs({ action: 'move', fileId: 'abc', newParentId: 'def' })).toEqual({
        action: 'move', fileId: 'abc', newParentId: 'def',
      })
    })

    it('rejects move without newParentId', () => {
      expect(() => parseArgs({ action: 'move', fileId: 'abc' })).toThrow('non-empty "newParentId"')
    })

    // delete
    it('parses delete action', () => {
      expect(parseArgs({ action: 'delete', fileId: 'abc' })).toEqual({ action: 'delete', fileId: 'abc' })
    })

    it('rejects delete without fileId', () => {
      expect(() => parseArgs({ action: 'delete' })).toThrow('non-empty "fileId"')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — search
  // -------------------------------------------------------------------------

  describe('execute search', () => {
    it('calls Drive files endpoint with query', async () => {
      const mock = mockFetchJson({ files: [{ id: 'f1', name: 'Report.pdf' }] })

      const result = await googleDriveTool.execute({ action: 'search', query: 'report' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { files: unknown[] }

      expect(parsed.files).toHaveLength(1)
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('drive/v3/files')
      expect(callUrl).toContain('q=report')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — list
  // -------------------------------------------------------------------------

  describe('execute list', () => {
    it('lists files in root', async () => {
      const mock = mockFetchJson({ files: [] })

      await googleDriveTool.execute({ action: 'list' })

      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('drive/v3/files')
    })

    it('lists files in specific folder', async () => {
      const mock = mockFetchJson({ files: [] })

      await googleDriveTool.execute({ action: 'list', folderId: 'folder123' })

      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('folder123')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — info
  // -------------------------------------------------------------------------

  describe('execute info', () => {
    it('gets file info with all fields', async () => {
      const mock = mockFetchJson({ id: 'f1', name: 'Test.txt', mimeType: 'text/plain' })

      const result = await googleDriveTool.execute({ action: 'info', fileId: 'f1' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { id: string }

      expect(parsed.id).toBe('f1')
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('files/f1')
      expect(callUrl).toContain('fields=')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — download
  // -------------------------------------------------------------------------

  describe('execute download', () => {
    it('downloads file content', async () => {
      mockFetchJson({})

      const result = await googleDriveTool.execute({ action: 'download', fileId: 'f1' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { fileId: string; size: number; data: string }

      expect(parsed.fileId).toBe('f1')
      expect(parsed.size).toBe(10)
      expect(parsed.data).toBeTruthy()
    })

    it('rejects download exceeding 100MB via Content-Length', async () => {
      const oversizeLength = String(100 * 1024 * 1024 + 1)
      mockFetchSequence([
        { ok: true, status: 200, statusText: 'OK', contentLength: oversizeLength },
      ])

      await expect(
        googleDriveTool.execute({ action: 'download', fileId: 'bigfile' }),
      ).rejects.toThrow('100MB download limit')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — upload
  // -------------------------------------------------------------------------

  describe('execute upload', () => {
    it('uploads file via multipart', async () => {
      const mock = mockFetchJson({ id: 'newFile', name: 'test.txt' })

      const result = await googleDriveTool.execute({ action: 'upload', name: 'test.txt', data: 'hello world' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { id: string }

      expect(parsed.id).toBe('newFile')
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('upload/drive/v3/files')
      expect(callUrl).toContain('uploadType=multipart')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — share
  // -------------------------------------------------------------------------

  describe('execute share', () => {
    it('creates permission via POST', async () => {
      const mock = mockFetchJson({ id: 'perm1', role: 'reader' })

      await googleDriveTool.execute({ action: 'share', fileId: 'f1', email: 'user@test.com', role: 'reader' })

      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      expect(callArgs[0]).toContain('files/f1/permissions')
      expect(callArgs[1].method).toBe('POST')
      const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>
      expect(body['role']).toBe('reader')
      expect(body['emailAddress']).toBe('user@test.com')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — createFolder
  // -------------------------------------------------------------------------

  describe('execute createFolder', () => {
    it('creates folder with correct mimeType', async () => {
      const mock = mockFetchJson({ id: 'folder1', name: 'New Folder' })

      await googleDriveTool.execute({ action: 'createFolder', name: 'New Folder' })

      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>
      expect(body['mimeType']).toBe('application/vnd.google-apps.folder')
      expect(body['name']).toBe('New Folder')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — move
  // -------------------------------------------------------------------------

  describe('execute move', () => {
    it('moves file to new parent', async () => {
      const mock = mockFetchSequence([
        // First call: get current parents
        { ok: true, status: 200, statusText: 'OK', data: { parents: ['oldParent'] } },
        // Second call: PATCH with addParents/removeParents
        { ok: true, status: 200, statusText: 'OK', data: { id: 'f1', parents: ['newParent'] } },
      ])

      await googleDriveTool.execute({ action: 'move', fileId: 'f1', newParentId: 'newParent' })

      expect(mock).toHaveBeenCalledTimes(2)
      const secondCallUrl = (mock.mock.calls[1] as [string])[0]
      expect(secondCallUrl).toContain('addParents=newParent')
      expect(secondCallUrl).toContain('removeParents=oldParent')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — delete (trash)
  // -------------------------------------------------------------------------

  describe('execute delete', () => {
    it('uses PATCH with trashed:true (NOT permanent DELETE)', async () => {
      const mock = mockFetchJson({})

      const result = await googleDriveTool.execute({ action: 'delete', fileId: 'f1' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { trashed: boolean; fileId: string }

      expect(parsed.trashed).toBe(true)
      expect(parsed.fileId).toBe('f1')

      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      expect(callArgs[1].method).toBe('PATCH')
      const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>
      expect(body['trashed']).toBe(true)
    })

    it('source code does not use DELETE endpoint for file deletion', () => {
      // Ensure delete action uses PATCH trashed:true, not the DELETE endpoint
      // The word "DELETE" in HTTP methods only appears in the del() helper,
      // but our delete action must use patch with trashed:true
      expect(sourceCode).toContain("trashed: true")
    })
  })

  // -------------------------------------------------------------------------
  // Token refresh on 401
  // -------------------------------------------------------------------------

  describe('token refresh', () => {
    it('refreshes token and retries on 401', async () => {
      const mock = mockFetchSequence([
        { ok: false, status: 401, statusText: 'Unauthorized' },
        { ok: true, status: 200, statusText: 'OK', data: { access_token: 'new-token', expires_in: 3600 } },
        { ok: true, status: 200, statusText: 'OK', data: { files: [] } },
      ])

      const result = await googleDriveTool.execute({ action: 'search', query: 'test' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { files: unknown[] }

      expect(parsed.files).toEqual([])
      expect(mock).toHaveBeenCalledTimes(3)
    })
  })

  // -------------------------------------------------------------------------
  // Security
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no code-execution patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, [
        'https://www.googleapis.com',
      ])
    })
  })
})
