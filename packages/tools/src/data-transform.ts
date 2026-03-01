/**
 * Data Transform tool — convert between CSV, JSON, YAML, XML, and Markdown tables.
 * All parsers are hand-written (zero external dependencies).
 * No network, no file I/O, no eval.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CsvToJsonArgs {
  readonly action: 'csvToJson'
  readonly csv: string
  readonly delimiter?: string
}

interface JsonToCsvArgs {
  readonly action: 'jsonToCsv'
  readonly json: string
  readonly delimiter?: string
}

interface YamlToJsonArgs {
  readonly action: 'yamlToJson'
  readonly yaml: string
}

interface JsonToYamlArgs {
  readonly action: 'jsonToYaml'
  readonly json: string
}

interface XmlToJsonArgs {
  readonly action: 'xmlToJson'
  readonly xml: string
}

interface TableToJsonArgs {
  readonly action: 'tableToJson'
  readonly table: string
}

interface JsonToTableArgs {
  readonly action: 'jsonToTable'
  readonly json: string
}

type DataTransformArgs =
  | CsvToJsonArgs | JsonToCsvArgs
  | YamlToJsonArgs | JsonToYamlArgs
  | XmlToJsonArgs
  | TableToJsonArgs | JsonToTableArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_INPUT_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_CSV_ROWS = 100_000
const MAX_DEPTH = 20

// ---------------------------------------------------------------------------
// CSV Parser (RFC 4180, char-by-char)
// ---------------------------------------------------------------------------

function parseCsv(input: string, delimiter: string = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < input.length) {
    const ch = input[i] as string

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote ""
        if (i + 1 < input.length && input[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        // End of quoted field
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    // Not in quotes
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }

    if (ch === delimiter) {
      row.push(field)
      field = ''
      i++
      continue
    }

    if (ch === '\r') {
      // Handle \r\n or standalone \r
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      if (i + 1 < input.length && input[i + 1] === '\n') {
        i += 2
      } else {
        i++
      }
      if (rows.length > MAX_CSV_ROWS) {
        throw new Error(`CSV exceeds maximum of ${String(MAX_CSV_ROWS)} rows`)
      }
      continue
    }

    if (ch === '\n') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      i++
      if (rows.length > MAX_CSV_ROWS) {
        throw new Error(`CSV exceeds maximum of ${String(MAX_CSV_ROWS)} rows`)
      }
      continue
    }

    field += ch
    i++
  }

  // Final field/row
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

function csvToJson(csv: string, delimiter: string = ','): Record<string, string>[] {
  const rows = parseCsv(csv, delimiter)
  if (rows.length < 2) {
    throw new Error('CSV must have at least a header row and one data row')
  }

  const headers = rows[0] as string[]
  const result: Record<string, string>[] = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as string[]
    const obj: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j] as string
      obj[key] = (row[j] as string | undefined) ?? ''
    }
    result.push(obj)
  }

  return result
}

function jsonToCsv(data: unknown[], delimiter: string = ','): string {
  if (data.length === 0) {
    throw new Error('JSON array must not be empty')
  }

  const first = data[0]
  if (typeof first !== 'object' || first === null || Array.isArray(first)) {
    throw new Error('Each JSON array element must be an object')
  }

  const headers = Object.keys(first)
  const lines: string[] = [headers.map((h) => escapeCsvField(h, delimiter)).join(delimiter)]

  for (const item of data) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('Each JSON array element must be an object')
    }
    const obj = item as Record<string, unknown>
    const row = headers.map((h) => escapeCsvField(String(obj[h] ?? ''), delimiter))
    lines.push(row.join(delimiter))
  }

  return lines.join('\n')
}

function escapeCsvField(field: string, delimiter: string): string {
  if (field.includes('"') || field.includes(delimiter) || field.includes('\n') || field.includes('\r')) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

// ---------------------------------------------------------------------------
// YAML Subset Parser (indentation-based)
// ---------------------------------------------------------------------------

type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue }

function parseYaml(input: string): YamlValue {
  const lines = input.split('\n')
  const result = parseYamlBlock(lines, 0, 0)
  return result.value
}

interface YamlParseResult {
  value: YamlValue
  nextLine: number
}

function getIndent(line: string): number {
  let indent = 0
  for (const ch of line) {
    if (ch === ' ') indent++
    else break
  }
  return indent
}

function parseYamlScalar(value: string): YamlValue {
  const trimmed = value.trim()

  // Quoted strings
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }

  // Booleans
  if (trimmed === 'true' || trimmed === 'True' || trimmed === 'TRUE') return true
  if (trimmed === 'false' || trimmed === 'False' || trimmed === 'FALSE') return false

  // Null
  if (trimmed === 'null' || trimmed === 'Null' || trimmed === 'NULL' || trimmed === '~' || trimmed === '') return null

  // Numbers
  const num = Number(trimmed)
  if (trimmed !== '' && !isNaN(num) && isFinite(num)) return num

  return trimmed
}

function parseYamlBlock(lines: string[], startLine: number, depth: number): YamlParseResult {
  if (depth > MAX_DEPTH) {
    throw new Error(`YAML nesting exceeds maximum depth of ${String(MAX_DEPTH)}`)
  }

  if (startLine >= lines.length) {
    return { value: null, nextLine: startLine }
  }

  // Skip empty lines and comments
  let lineIdx = startLine
  while (lineIdx < lines.length) {
    const trimmed = (lines[lineIdx] as string).trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      lineIdx++
    } else {
      break
    }
  }

  if (lineIdx >= lines.length) {
    return { value: null, nextLine: lineIdx }
  }

  const firstLine = lines[lineIdx] as string
  const baseIndent = getIndent(firstLine)
  const trimmedFirst = firstLine.trim()

  // Array? (starts with "- ")
  if (trimmedFirst.startsWith('- ')) {
    const arr: YamlValue[] = []
    let i = lineIdx

    while (i < lines.length) {
      const line = lines[i] as string
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) {
        i++
        continue
      }

      const indent = getIndent(line)
      if (indent < baseIndent) break
      if (indent > baseIndent) break // Child block handled by recursion

      if (trimmed.startsWith('- ')) {
        const afterDash = trimmed.slice(2)
        // Check if this is a nested structure
        if (afterDash.includes(': ') || afterDash.endsWith(':')) {
          // Inline key-value after dash — parse as object starting from next line or inline
          const subResult = parseYamlBlock(
            [' '.repeat(indent + 2) + afterDash, ...lines.slice(i + 1)],
            0,
            depth + 1,
          )
          arr.push(subResult.value)
          // Calculate actual lines consumed
          i = i + 1 + (subResult.nextLine > 0 ? subResult.nextLine - 1 : 0)
        } else {
          arr.push(parseYamlScalar(afterDash))
          i++
        }
      } else {
        break
      }
    }

    return { value: arr, nextLine: i }
  }

  // Object? (contains ": " or ends with ":")
  if (trimmedFirst.includes(': ') || trimmedFirst.endsWith(':')) {
    const obj: Record<string, YamlValue> = {}
    let i = lineIdx

    while (i < lines.length) {
      const line = lines[i] as string
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) {
        i++
        continue
      }

      const indent = getIndent(line)
      if (indent < baseIndent) break
      if (indent > baseIndent) break

      const colonIdx = trimmed.indexOf(':')
      if (colonIdx === -1) break

      const key = trimmed.slice(0, colonIdx).trim()
      const afterColon = trimmed.slice(colonIdx + 1).trim()

      if (afterColon === '' || afterColon === '') {
        // Value is on next lines (nested block)
        const subResult = parseYamlBlock(lines, i + 1, depth + 1)
        obj[key] = subResult.value
        i = subResult.nextLine
      } else {
        obj[key] = parseYamlScalar(afterColon)
        i++
      }
    }

    return { value: obj, nextLine: i }
  }

  // Scalar
  return { value: parseYamlScalar(trimmedFirst), nextLine: lineIdx + 1 }
}

// ---------------------------------------------------------------------------
// JSON → YAML
// ---------------------------------------------------------------------------

function jsonToYaml(data: unknown, indent: number = 0): string {
  if (indent / 2 > MAX_DEPTH) {
    throw new Error(`YAML nesting exceeds maximum depth of ${String(MAX_DEPTH)}`)
  }

  const prefix = ' '.repeat(indent)

  if (data === null || data === undefined) return `${prefix}null`
  if (typeof data === 'boolean') return `${prefix}${String(data)}`
  if (typeof data === 'number') return `${prefix}${String(data)}`
  if (typeof data === 'string') {
    if (data.includes('\n') || data.includes(':') || data.includes('#') ||
        data.startsWith('"') || data.startsWith("'") ||
        data === 'true' || data === 'false' || data === 'null') {
      return `${prefix}"${data.replace(/"/g, '\\"')}"`
    }
    return `${prefix}${data}`
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return `${prefix}[]`
    const lines: string[] = []
    for (const item of data) {
      if (typeof item === 'object' && item !== null) {
        const sub = jsonToYaml(item, indent + 2)
        // Put first key on same line as dash
        const trimmed = sub.trimStart()
        lines.push(`${prefix}- ${trimmed}`)
      } else {
        const scalar = jsonToYaml(item, 0)
        lines.push(`${prefix}- ${scalar.trim()}`)
      }
    }
    return lines.join('\n')
  }

  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const keys = Object.keys(obj)
    if (keys.length === 0) return `${prefix}{}`
    const lines: string[] = []
    for (const key of keys) {
      const value = obj[key]
      if (typeof value === 'object' && value !== null) {
        lines.push(`${prefix}${key}:`)
        lines.push(jsonToYaml(value, indent + 2))
      } else {
        const scalar = jsonToYaml(value, 0)
        lines.push(`${prefix}${key}: ${scalar.trim()}`)
      }
    }
    return lines.join('\n')
  }

  return `${prefix}${String(data)}`
}

// ---------------------------------------------------------------------------
// XML → JSON (regex-based, like news-feed.ts)
// ---------------------------------------------------------------------------

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
  // XXE protection: ONLY decode these 5 built-in XML entities
  // No external entity expansion, no custom entities
}

function stripCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
}

function xmlToJson(xml: string): unknown {
  // Strip XML declaration and comments
  let cleaned = xml
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '') // XXE: strip DOCTYPE entirely
    .trim()

  cleaned = stripCdata(cleaned)

  // Simple tag-based parser using stack
  const root = parseXmlElement(cleaned, 0)
  return root.value
}

interface XmlParseResult {
  value: unknown
  endIndex: number
}

function parseXmlElement(xml: string, depth: number): XmlParseResult {
  if (depth > MAX_DEPTH) {
    throw new Error(`XML nesting exceeds maximum depth of ${String(MAX_DEPTH)}`)
  }

  // Find opening tag
  const tagStart = xml.indexOf('<')
  if (tagStart === -1) {
    // Pure text
    return { value: decodeXmlEntities(xml.trim()), endIndex: xml.length }
  }

  // Text before first tag
  const textBefore = xml.slice(0, tagStart).trim()
  if (textBefore !== '' && !xml.slice(tagStart).startsWith('<')) {
    return { value: decodeXmlEntities(textBefore), endIndex: tagStart }
  }

  // Parse opening tag
  const openMatch = xml.slice(tagStart).match(/^<([a-zA-Z][\w:.-]*)((?:\s+[a-zA-Z][\w:.-]*\s*=\s*"[^"]*")*)\s*(\/?)>/)
  if (!openMatch) {
    return { value: decodeXmlEntities(xml.trim()), endIndex: xml.length }
  }

  const tagName = openMatch[1] as string
  const attrString = openMatch[2] ?? ''
  const selfClosing = openMatch[3] === '/'
  const afterOpen = tagStart + openMatch[0].length

  // Parse attributes
  const attributes: Record<string, string> = {}
  const attrRegex = /([a-zA-Z][\w:.-]*)\s*=\s*"([^"]*)"/g
  for (const attrMatch of attrString.matchAll(attrRegex)) {
    attributes[attrMatch[1] as string] = decodeXmlEntities(attrMatch[2] as string)
  }

  if (selfClosing) {
    const result: Record<string, unknown> = { ...attributes }
    return { value: { [tagName]: Object.keys(result).length > 0 ? result : null }, endIndex: afterOpen }
  }

  // Find closing tag
  const closeTag = `</${tagName}>`
  const content = xml.slice(afterOpen)
  const closeIdx = findMatchingClose(content, tagName)
  if (closeIdx === -1) {
    return { value: { [tagName]: decodeXmlEntities(content.trim()) }, endIndex: xml.length }
  }

  const innerContent = content.slice(0, closeIdx).trim()
  const endPos = afterOpen + closeIdx + closeTag.length

  // Check if inner content has child elements
  if (innerContent.includes('<') && /<[a-zA-Z]/.test(innerContent)) {
    const children = parseXmlChildren(innerContent, depth + 1)
    if (Object.keys(attributes).length > 0) {
      return { value: { [tagName]: { ...attributes, ...children } }, endIndex: endPos }
    }
    return { value: { [tagName]: children }, endIndex: endPos }
  }

  // Text-only content
  const textValue = decodeXmlEntities(innerContent)
  if (Object.keys(attributes).length > 0) {
    return { value: { [tagName]: { ...attributes, '#text': textValue } }, endIndex: endPos }
  }
  return { value: { [tagName]: textValue }, endIndex: endPos }
}

function findMatchingClose(content: string, tagName: string): number {
  let depth = 0
  let i = 0
  const openPattern = new RegExp(`<${tagName}(\\s|>|/)`)
  const closeTag = `</${tagName}>`

  while (i < content.length) {
    if (content.slice(i).startsWith(closeTag)) {
      if (depth === 0) return i
      depth--
      i += closeTag.length
      continue
    }

    const remaining = content.slice(i)
    if (remaining.startsWith('<') && openPattern.test(remaining)) {
      // Check for self-closing
      const tagEnd = remaining.indexOf('>')
      if (tagEnd !== -1 && remaining[tagEnd - 1] !== '/') {
        depth++
      }
      i += tagEnd + 1
      continue
    }

    i++
  }

  return -1
}

function parseXmlChildren(xml: string, depth: number): Record<string, unknown> {
  if (depth > MAX_DEPTH) {
    throw new Error(`XML nesting exceeds maximum depth of ${String(MAX_DEPTH)}`)
  }

  const result: Record<string, unknown> = {}
  let remaining = xml.trim()

  while (remaining.length > 0) {
    const tagStart = remaining.indexOf('<')
    if (tagStart === -1) break
    if (tagStart > 0) {
      const text = remaining.slice(0, tagStart).trim()
      if (text) {
        result['#text'] = decodeXmlEntities(text)
      }
    }

    const parsed = parseXmlElement(remaining.slice(tagStart), depth)
    if (typeof parsed.value === 'object' && parsed.value !== null) {
      const obj = parsed.value as Record<string, unknown>
      for (const [key, value] of Object.entries(obj)) {
        if (key in result) {
          // Multiple same-name children → array
          const existing = result[key]
          if (Array.isArray(existing)) {
            existing.push(value)
          } else {
            result[key] = [existing, value]
          }
        } else {
          result[key] = value
        }
      }
    }

    remaining = remaining.slice(tagStart + parsed.endIndex).trim()
  }

  return result
}

// ---------------------------------------------------------------------------
// Markdown Table ↔ JSON
// ---------------------------------------------------------------------------

function tableToJson(table: string): Record<string, string>[] {
  const lines = table.trim().split('\n').filter((l) => l.trim() !== '')
  if (lines.length < 2) {
    throw new Error('Markdown table must have at least a header and separator row')
  }

  const parseRow = (line: string): string[] => {
    return line.split('|').map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1)
  }

  const headers = parseRow(lines[0] as string)

  // Skip separator row (line with ---)
  const separatorIdx = 1
  const separator = (lines[separatorIdx] as string).trim()
  if (!separator.includes('-')) {
    throw new Error('Expected separator row with dashes after header')
  }

  const result: Record<string, string>[] = []
  for (let i = separatorIdx + 1; i < lines.length; i++) {
    const cells = parseRow(lines[i] as string)
    const obj: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j] as string] = (cells[j] as string | undefined) ?? ''
    }
    result.push(obj)
  }

  return result
}

function jsonToTable(data: unknown[]): string {
  if (data.length === 0) {
    throw new Error('JSON array must not be empty')
  }

  const first = data[0]
  if (typeof first !== 'object' || first === null || Array.isArray(first)) {
    throw new Error('Each JSON array element must be an object')
  }

  const headers = Object.keys(first)
  const headerRow = `| ${headers.join(' | ')} |`
  const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`

  const dataRows = data.map((item) => {
    const obj = item as Record<string, unknown>
    const cells = headers.map((h) => String(obj[h] ?? ''))
    return `| ${cells.join(' | ')} |`
  })

  return [headerRow, separatorRow, ...dataRows].join('\n')
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function validateInputSize(input: string, label: string): void {
  if (input.length > MAX_INPUT_SIZE) {
    throw new Error(`${label} exceeds maximum size of 5MB`)
  }
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

function executeCsvToJson(args: CsvToJsonArgs): AgentToolResult {
  validateInputSize(args.csv, 'CSV input')
  const result = csvToJson(args.csv, args.delimiter ?? ',')
  return textResult(JSON.stringify({ data: result, rows: result.length }))
}

function executeJsonToCsv(args: JsonToCsvArgs): AgentToolResult {
  validateInputSize(args.json, 'JSON input')
  const data = JSON.parse(args.json) as unknown
  if (!Array.isArray(data)) {
    throw new Error('JSON must be an array of objects')
  }
  const csv = jsonToCsv(data, args.delimiter ?? ',')
  return textResult(JSON.stringify({ csv }))
}

function executeYamlToJson(args: YamlToJsonArgs): AgentToolResult {
  validateInputSize(args.yaml, 'YAML input')
  const result = parseYaml(args.yaml)
  return textResult(JSON.stringify({ data: result }))
}

function executeJsonToYaml(args: JsonToYamlArgs): AgentToolResult {
  validateInputSize(args.json, 'JSON input')
  const data = JSON.parse(args.json) as unknown
  const yaml = jsonToYaml(data)
  return textResult(JSON.stringify({ yaml }))
}

function executeXmlToJson(args: XmlToJsonArgs): AgentToolResult {
  validateInputSize(args.xml, 'XML input')
  const result = xmlToJson(args.xml)
  return textResult(JSON.stringify({ data: result }))
}

function executeTableToJson(args: TableToJsonArgs): AgentToolResult {
  validateInputSize(args.table, 'Table input')
  const result = tableToJson(args.table)
  return textResult(JSON.stringify({ data: result, rows: result.length }))
}

function executeJsonToTable(args: JsonToTableArgs): AgentToolResult {
  validateInputSize(args.json, 'JSON input')
  const data = JSON.parse(args.json) as unknown
  if (!Array.isArray(data)) {
    throw new Error('JSON must be an array of objects')
  }
  const table = jsonToTable(data)
  return textResult(JSON.stringify({ table }))
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): DataTransformArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'csvToJson') {
    const csv = obj['csv']
    if (typeof csv !== 'string') {
      throw new Error('csvToJson requires a "csv" string')
    }
    const delimiter = typeof obj['delimiter'] === 'string' ? obj['delimiter'] : undefined
    return { action: 'csvToJson', csv, delimiter }
  }

  if (action === 'jsonToCsv') {
    const json = obj['json']
    if (typeof json !== 'string') {
      throw new Error('jsonToCsv requires a "json" string')
    }
    const delimiter = typeof obj['delimiter'] === 'string' ? obj['delimiter'] : undefined
    return { action: 'jsonToCsv', json, delimiter }
  }

  if (action === 'yamlToJson') {
    const yaml = obj['yaml']
    if (typeof yaml !== 'string') {
      throw new Error('yamlToJson requires a "yaml" string')
    }
    return { action: 'yamlToJson', yaml }
  }

  if (action === 'jsonToYaml') {
    const json = obj['json']
    if (typeof json !== 'string') {
      throw new Error('jsonToYaml requires a "json" string')
    }
    return { action: 'jsonToYaml', json }
  }

  if (action === 'xmlToJson') {
    const xml = obj['xml']
    if (typeof xml !== 'string') {
      throw new Error('xmlToJson requires an "xml" string')
    }
    return { action: 'xmlToJson', xml }
  }

  if (action === 'tableToJson') {
    const table = obj['table']
    if (typeof table !== 'string') {
      throw new Error('tableToJson requires a "table" string')
    }
    return { action: 'tableToJson', table }
  }

  if (action === 'jsonToTable') {
    const json = obj['json']
    if (typeof json !== 'string') {
      throw new Error('jsonToTable requires a "json" string')
    }
    return { action: 'jsonToTable', json }
  }

  throw new Error('action must be "csvToJson", "jsonToCsv", "yamlToJson", "jsonToYaml", "xmlToJson", "tableToJson", or "jsonToTable"')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action: "csvToJson", "jsonToCsv", "yamlToJson", "jsonToYaml", "xmlToJson", "tableToJson", or "jsonToTable"',
      enum: ['csvToJson', 'jsonToCsv', 'yamlToJson', 'jsonToYaml', 'xmlToJson', 'tableToJson', 'jsonToTable'],
    },
    csv: {
      type: 'string',
      description: 'CSV data (for csvToJson)',
    },
    json: {
      type: 'string',
      description: 'JSON string (for jsonToCsv, jsonToYaml, jsonToTable)',
    },
    yaml: {
      type: 'string',
      description: 'YAML string (for yamlToJson)',
    },
    xml: {
      type: 'string',
      description: 'XML string (for xmlToJson)',
    },
    table: {
      type: 'string',
      description: 'Markdown table string (for tableToJson)',
    },
    delimiter: {
      type: 'string',
      description: 'CSV delimiter (default ",")',
    },
  },
  required: ['action'],
}

export const dataTransformTool: ExtendedAgentTool = {
  name: 'data-transform',
  description:
    'Convert between data formats. Actions: csvToJson(csv, delimiter?), jsonToCsv(json, delimiter?), yamlToJson(yaml), jsonToYaml(json), xmlToJson(xml), tableToJson(table), jsonToTable(json). All parsers are built-in (no external deps). Max 5MB input, CSV max 100k rows, YAML/XML max depth 20.',
  parameters,
  permissions: [],
  requiresConfirmation: false,
  defaultRiskTier: 0,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'csvToJson':
        return executeCsvToJson(parsed)
      case 'jsonToCsv':
        return executeJsonToCsv(parsed)
      case 'yamlToJson':
        return executeYamlToJson(parsed)
      case 'jsonToYaml':
        return executeJsonToYaml(parsed)
      case 'xmlToJson':
        return executeXmlToJson(parsed)
      case 'tableToJson':
        return executeTableToJson(parsed)
      case 'jsonToTable':
        return executeJsonToTable(parsed)
    }
  },
}

export { parseCsv, parseYaml, xmlToJson as parseXml, decodeXmlEntities }
