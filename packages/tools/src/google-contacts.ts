/**
 * Google Contacts tool — search, get, list, and view contact groups.
 * Read-only access via People API (contacts.readonly scope).
 *
 * URL policy: Only requests to people.googleapis.com.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'
import { createGoogleApiClient, type GoogleApiClient } from './google-api'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'https://people.googleapis.com'
const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 25

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'people.googleapis.com',
])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchArgs {
  readonly action: 'search'
  readonly query: string
}

interface GetArgs {
  readonly action: 'get'
  readonly resourceName: string
}

interface ListArgs {
  readonly action: 'list'
  readonly pageSize: number
  readonly pageToken?: string
}

interface GroupsArgs {
  readonly action: 'groups'
}

type ContactsArgs = SearchArgs | GetArgs | ListArgs | GroupsArgs

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
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): ContactsArgs {
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

  if (action === 'get') {
    const resourceName = obj['resourceName']
    if (typeof resourceName !== 'string' || resourceName.trim() === '') {
      throw new Error('get requires a non-empty "resourceName" string')
    }
    return { action: 'get', resourceName: resourceName.trim() }
  }

  if (action === 'list') {
    let pageSize = DEFAULT_PAGE_SIZE
    if (obj['pageSize'] !== undefined) {
      if (
        typeof obj['pageSize'] !== 'number' ||
        !Number.isInteger(obj['pageSize']) ||
        obj['pageSize'] < 1
      ) {
        throw new Error('pageSize must be a positive integer')
      }
      pageSize = Math.min(obj['pageSize'], MAX_PAGE_SIZE)
    }
    const pageToken = typeof obj['pageToken'] === 'string' ? obj['pageToken'].trim() : undefined
    return { action: 'list', pageSize, pageToken }
  }

  if (action === 'groups') {
    return { action: 'groups' }
  }

  throw new Error(
    'action must be "search", "get", "list", or "groups"',
  )
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

async function executeSearch(query: string): Promise<AgentToolResult> {
  const api = getClient()
  const result = await api.get(`${API_BASE}/v1/people:searchContacts`, {
    query,
    readMask: 'names,emailAddresses,phoneNumbers',
    pageSize: String(DEFAULT_PAGE_SIZE),
  })

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  }
}

async function executeGet(resourceName: string): Promise<AgentToolResult> {
  const api = getClient()
  const encodedName = encodeURIComponent(resourceName).replace(/%2F/g, '/')
  const result = await api.get(`${API_BASE}/v1/${encodedName}`, {
    personFields: 'names,emailAddresses,phoneNumbers,organizations,addresses,birthdays,biographies',
  })

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  }
}

async function executeList(pageSize: number, pageToken?: string): Promise<AgentToolResult> {
  const api = getClient()
  const params: Record<string, string> = {
    personFields: 'names,emailAddresses,phoneNumbers',
    pageSize: String(pageSize),
  }
  if (pageToken) {
    params['pageToken'] = pageToken
  }
  const result = await api.get(`${API_BASE}/v1/people/me/connections`, params)

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  }
}

async function executeGroups(): Promise<AgentToolResult> {
  const api = getClient()
  const result = await api.get(`${API_BASE}/v1/contactGroups`)

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const contactsParameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action to perform: search, get, list, or groups',
      enum: ['search', 'get', 'list', 'groups'],
    },
    query: {
      type: 'string',
      description: 'Search query (required for search)',
    },
    resourceName: {
      type: 'string',
      description: 'Contact resource name e.g. "people/c123" (required for get)',
    },
    pageSize: {
      type: 'integer',
      description: 'Number of contacts to return (default 25, max 100)',
    },
    pageToken: {
      type: 'string',
      description: 'Pagination token for next page (list)',
    },
  },
  required: ['action'],
}

export const googleContactsTool: ExtendedAgentTool = {
  name: 'google-contacts',
  description:
    'Search and view Google Contacts (read-only). Actions: search(query), get(resourceName), list(pageSize?, pageToken?), groups(). Confirmation required.',
  parameters: contactsParameters,
  permissions: ['net:http', 'google:contacts'],
  requiresConfirmation: true,
  defaultRiskTier: 1,
  riskTiers: { search: 1, get: 1, list: 1, groups: 1 },
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'search':
        return executeSearch(parsed.query)
      case 'get':
        return executeGet(parsed.resourceName)
      case 'list':
        return executeList(parsed.pageSize, parsed.pageToken)
      case 'groups':
        return executeGroups()
    }
  },
}

export { parseArgs }

/** Test-only: resets the client instance. */
export function _resetClient(): void {
  client = undefined
}
