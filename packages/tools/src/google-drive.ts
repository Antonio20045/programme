/**
 * Google Drive tool — search, list, info, download, upload, share, folders, move, delete (trash).
 * Uses drive.file scope — only files created/opened by the app.
 *
 * URL policy: Only requests to www.googleapis.com.
 * Security: download max 100MB, upload max 50MB, share roles restricted, delete = trash only.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'
import { createGoogleApiClient, type GoogleApiClient } from './google-api'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'https://www.googleapis.com/drive/v3'
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3'
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024 // 100 MB
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB
const VALID_SHARE_ROLES: ReadonlySet<string> = new Set(['reader', 'commenter', 'writer'])
const FILE_ID_REGEX = /^[a-zA-Z0-9_-]+$/
const FOLDER_MIME = 'application/vnd.google-apps.folder'

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'www.googleapis.com',
])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchArgs { readonly action: 'search'; readonly query: string }
interface ListArgs { readonly action: 'list'; readonly folderId?: string }
interface InfoArgs { readonly action: 'info'; readonly fileId: string }
interface DownloadArgs { readonly action: 'download'; readonly fileId: string }
interface UploadArgs {
  readonly action: 'upload'
  readonly name: string
  readonly data: string
  readonly mimeType?: string
  readonly folderId?: string
}
interface ShareArgs {
  readonly action: 'share'
  readonly fileId: string
  readonly email: string
  readonly role: string
}
interface CreateFolderArgs {
  readonly action: 'createFolder'
  readonly name: string
  readonly parentId?: string
}
interface MoveArgs {
  readonly action: 'move'
  readonly fileId: string
  readonly newParentId: string
}
interface DeleteArgs {
  readonly action: 'delete'
  readonly fileId: string
}

type DriveArgs =
  | SearchArgs | ListArgs | InfoArgs | DownloadArgs | UploadArgs
  | ShareArgs | CreateFolderArgs | MoveArgs | DeleteArgs

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

function getAccessToken(): Promise<string> {
  const token = process.env['GOOGLE_ACCESS_TOKEN']
  if (token) return Promise.resolve(token)
  throw new Error('GOOGLE_ACCESS_TOKEN environment variable is required')
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let client: GoogleApiClient | undefined

function getClient(): GoogleApiClient {
  if (!client) {
    client = createGoogleApiClient({
      getAccessToken,
      allowedHosts: ALLOWED_HOSTS,
    })
  }
  return client
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateFileId(fileId: string): void {
  if (!FILE_ID_REGEX.test(fileId)) {
    throw new Error('fileId contains invalid characters')
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): DriveArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'search') {
    const query = obj['query']
    if (typeof query !== 'string' || query.trim() === '') {
      throw new Error('search requires a non-empty "query" string')
    }
    return { action: 'search', query: query.trim() }
  }

  if (action === 'list') {
    const folderId = typeof obj['folderId'] === 'string' && obj['folderId'].trim() !== ''
      ? obj['folderId'].trim()
      : undefined
    if (folderId !== undefined) validateFileId(folderId)
    return { action: 'list', folderId }
  }

  if (action === 'info') {
    const fileId = obj['fileId']
    if (typeof fileId !== 'string' || fileId.trim() === '') {
      throw new Error('info requires a non-empty "fileId" string')
    }
    validateFileId(fileId.trim())
    return { action: 'info', fileId: fileId.trim() }
  }

  if (action === 'download') {
    const fileId = obj['fileId']
    if (typeof fileId !== 'string' || fileId.trim() === '') {
      throw new Error('download requires a non-empty "fileId" string')
    }
    validateFileId(fileId.trim())
    return { action: 'download', fileId: fileId.trim() }
  }

  if (action === 'upload') {
    const name = obj['name']
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error('upload requires a non-empty "name" string')
    }
    const data = obj['data']
    if (typeof data !== 'string') {
      throw new Error('upload requires a "data" string')
    }
    if (Buffer.byteLength(data, 'utf-8') > MAX_UPLOAD_BYTES) {
      throw new Error(`upload data exceeds ${String(MAX_UPLOAD_BYTES / (1024 * 1024))}MB limit`)
    }
    const mimeType = typeof obj['mimeType'] === 'string' ? obj['mimeType'].trim() : undefined
    const folderId = typeof obj['folderId'] === 'string' && obj['folderId'].trim() !== ''
      ? obj['folderId'].trim()
      : undefined
    if (folderId !== undefined) validateFileId(folderId)
    return { action: 'upload', name: name.trim(), data, mimeType, folderId }
  }

  if (action === 'share') {
    const fileId = obj['fileId']
    if (typeof fileId !== 'string' || fileId.trim() === '') {
      throw new Error('share requires a non-empty "fileId" string')
    }
    validateFileId(fileId.trim())
    const email = obj['email']
    if (typeof email !== 'string' || email.trim() === '') {
      throw new Error('share requires a non-empty "email" string')
    }
    const role = obj['role']
    if (typeof role !== 'string' || !VALID_SHARE_ROLES.has(role)) {
      throw new Error('share role must be "reader", "commenter", or "writer" (owner transfer not allowed)')
    }
    return { action: 'share', fileId: fileId.trim(), email: email.trim(), role }
  }

  if (action === 'createFolder') {
    const name = obj['name']
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error('createFolder requires a non-empty "name" string')
    }
    const parentId = typeof obj['parentId'] === 'string' && obj['parentId'].trim() !== ''
      ? obj['parentId'].trim()
      : undefined
    if (parentId !== undefined) validateFileId(parentId)
    return { action: 'createFolder', name: name.trim(), parentId }
  }

  if (action === 'move') {
    const fileId = obj['fileId']
    if (typeof fileId !== 'string' || fileId.trim() === '') {
      throw new Error('move requires a non-empty "fileId" string')
    }
    validateFileId(fileId.trim())
    const newParentId = obj['newParentId']
    if (typeof newParentId !== 'string' || newParentId.trim() === '') {
      throw new Error('move requires a non-empty "newParentId" string')
    }
    validateFileId(newParentId.trim())
    return { action: 'move', fileId: fileId.trim(), newParentId: newParentId.trim() }
  }

  if (action === 'delete') {
    const fileId = obj['fileId']
    if (typeof fileId !== 'string' || fileId.trim() === '') {
      throw new Error('delete requires a non-empty "fileId" string')
    }
    validateFileId(fileId.trim())
    return { action: 'delete', fileId: fileId.trim() }
  }

  throw new Error(
    'action must be "search", "list", "info", "download", "upload", "share", "createFolder", "move", or "delete"',
  )
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

const FILE_FIELDS = 'files(id,name,mimeType,size,modifiedTime,webViewLink)'

async function executeSearch(query: string): Promise<AgentToolResult> {
  const api = getClient()
  const result = await api.get(`${API_BASE}/files`, {
    q: query,
    fields: FILE_FIELDS,
  })
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeList(folderId?: string): Promise<AgentToolResult> {
  const api = getClient()
  const q = folderId ? `'${folderId}' in parents` : undefined
  const params: Record<string, string> = { fields: FILE_FIELDS }
  if (q) params['q'] = q
  const result = await api.get(`${API_BASE}/files`, params)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeInfo(fileId: string): Promise<AgentToolResult> {
  const api = getClient()
  const result = await api.get(`${API_BASE}/files/${encodeURIComponent(fileId)}`, {
    fields: '*',
  })
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeDownload(fileId: string): Promise<AgentToolResult> {
  const api = getClient()
  const response = await api.rawFetch(
    `${API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
    { method: 'GET' },
  )

  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_DOWNLOAD_BYTES) {
    throw new Error(`File exceeds ${String(MAX_DOWNLOAD_BYTES / (1024 * 1024))}MB download limit`)
  }

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`File exceeds ${String(MAX_DOWNLOAD_BYTES / (1024 * 1024))}MB download limit`)
  }

  const base64 = Buffer.from(buffer).toString('base64')
  return {
    content: [{ type: 'text', text: JSON.stringify({ fileId, size: buffer.byteLength, data: base64 }) }],
  }
}

async function executeUpload(parsed: UploadArgs): Promise<AgentToolResult> {
  const api = getClient()

  const metadata: Record<string, unknown> = { name: parsed.name }
  if (parsed.folderId) {
    metadata['parents'] = [parsed.folderId]
  }

  const boundary = '---ki-assistent-boundary'
  const mimeType = parsed.mimeType ?? 'application/octet-stream'

  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    '',
    parsed.data,
    `--${boundary}--`,
  ].join('\r\n')

  const response = await api.rawFetch(
    `${UPLOAD_BASE}/files?uploadType=multipart`,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    },
  )

  const result = await response.json()
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeShare(fileId: string, email: string, role: string): Promise<AgentToolResult> {
  const api = getClient()
  const result = await api.post(
    `${API_BASE}/files/${encodeURIComponent(fileId)}/permissions`,
    { type: 'user', role, emailAddress: email },
  )
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeCreateFolder(name: string, parentId?: string): Promise<AgentToolResult> {
  const api = getClient()
  const body: Record<string, unknown> = {
    name,
    mimeType: FOLDER_MIME,
  }
  if (parentId) {
    body['parents'] = [parentId]
  }
  const result = await api.post(`${API_BASE}/files`, body)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeMove(fileId: string, newParentId: string): Promise<AgentToolResult> {
  const api = getClient()

  // Get current parents first
  const fileInfo = (await api.get(`${API_BASE}/files/${encodeURIComponent(fileId)}`, {
    fields: 'parents',
  })) as { parents?: readonly string[] }

  const currentParents = fileInfo.parents ?? []
  const removeParents = currentParents.join(',')

  const result = await api.patch(
    `${API_BASE}/files/${encodeURIComponent(fileId)}?addParents=${encodeURIComponent(newParentId)}&removeParents=${encodeURIComponent(removeParents)}`,
  )
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeDelete(fileId: string): Promise<AgentToolResult> {
  const api = getClient()
  // Use trashed: true (Papierkorb), NOT permanent delete
  await api.patch(`${API_BASE}/files/${encodeURIComponent(fileId)}`, { trashed: true })
  return { content: [{ type: 'text', text: JSON.stringify({ trashed: true, fileId }) }] }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const driveParameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action to perform',
      enum: ['search', 'list', 'info', 'download', 'upload', 'share', 'createFolder', 'move', 'delete'],
    },
    query: {
      type: 'string',
      description: 'Drive search query (search)',
    },
    fileId: {
      type: 'string',
      description: 'File ID (info, download, share, move, delete)',
    },
    folderId: {
      type: 'string',
      description: 'Folder ID to list or upload into',
    },
    name: {
      type: 'string',
      description: 'File or folder name (upload, createFolder)',
    },
    data: {
      type: 'string',
      description: 'File content as text (upload, max 50MB)',
    },
    mimeType: {
      type: 'string',
      description: 'MIME type (upload, default application/octet-stream)',
    },
    email: {
      type: 'string',
      description: 'Email address to share with (share)',
    },
    role: {
      type: 'string',
      description: 'Share role: reader, commenter, or writer (share)',
      enum: ['reader', 'commenter', 'writer'],
    },
    parentId: {
      type: 'string',
      description: 'Parent folder ID (createFolder)',
    },
    newParentId: {
      type: 'string',
      description: 'Target folder ID (move)',
    },
  },
  required: ['action'],
}

export const googleDriveTool: ExtendedAgentTool = {
  name: 'google-drive',
  description:
    'Manage Google Drive files. Actions: search(query), list(folderId?), info(fileId), download(fileId), upload(name, data, mimeType?, folderId?), share(fileId, email, role), createFolder(name, parentId?), move(fileId, newParentId), delete(fileId). Delete moves to trash. Confirmation required.',
  parameters: driveParameters,
  permissions: ['net:http', 'google:drive'],
  requiresConfirmation: true,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'search':
        return executeSearch(parsed.query)
      case 'list':
        return executeList(parsed.folderId)
      case 'info':
        return executeInfo(parsed.fileId)
      case 'download':
        return executeDownload(parsed.fileId)
      case 'upload':
        return executeUpload(parsed)
      case 'share':
        return executeShare(parsed.fileId, parsed.email, parsed.role)
      case 'createFolder':
        return executeCreateFolder(parsed.name, parsed.parentId)
      case 'move':
        return executeMove(parsed.fileId, parsed.newParentId)
      case 'delete':
        return executeDelete(parsed.fileId)
    }
  },
}

export { parseArgs }

/** Test-only: resets the client instance. */
export function _resetClient(): void {
  client = undefined
}
