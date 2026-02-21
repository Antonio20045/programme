import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { dataTransformTool, parseCsv, parseYaml, parseXml, decodeXmlEntities } from '../src/data-transform'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/data-transform.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(result: { content: readonly { type: string; text?: string }[] }): unknown {
  const first = result.content[0] as { type: 'text'; text: string }
  return JSON.parse(first.text)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('data-transform tool', () => {
  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(dataTransformTool.name).toBe('data-transform')
    })

    it('runs on server', () => {
      expect(dataTransformTool.runsOn).toBe('server')
    })

    it('has no permissions', () => {
      expect(dataTransformTool.permissions).toEqual([])
    })

    it('does not require confirmation', () => {
      expect(dataTransformTool.requiresConfirmation).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // csvToJson()
  // -------------------------------------------------------------------------

  describe('csvToJson()', () => {
    it('parses simple CSV', async () => {
      const csv = 'name,age\nAlice,30\nBob,25'
      const result = parseResult(await dataTransformTool.execute({
        action: 'csvToJson', csv,
      })) as { data: Record<string, string>[]; rows: number }
      expect(result.rows).toBe(2)
      expect(result.data[0]).toEqual({ name: 'Alice', age: '30' })
      expect(result.data[1]).toEqual({ name: 'Bob', age: '25' })
    })

    it('handles quoted fields with commas', async () => {
      const csv = 'name,address\nAlice,"123 Main St, Apt 4"\nBob,"456 Oak Ave"'
      const result = parseResult(await dataTransformTool.execute({
        action: 'csvToJson', csv,
      })) as { data: Record<string, string>[] }
      expect(result.data[0]?.['address']).toBe('123 Main St, Apt 4')
    })

    it('handles escaped quotes in fields', async () => {
      const csv = 'name,quote\nAlice,"She said ""hello"""\nBob,simple'
      const result = parseResult(await dataTransformTool.execute({
        action: 'csvToJson', csv,
      })) as { data: Record<string, string>[] }
      expect(result.data[0]?.['quote']).toBe('She said "hello"')
    })

    it('handles custom delimiter', async () => {
      const csv = 'name;age\nAlice;30'
      const result = parseResult(await dataTransformTool.execute({
        action: 'csvToJson', csv, delimiter: ';',
      })) as { data: Record<string, string>[] }
      expect(result.data[0]).toEqual({ name: 'Alice', age: '30' })
    })

    it('rejects CSV without data rows', async () => {
      await expect(
        dataTransformTool.execute({ action: 'csvToJson', csv: 'header' }),
      ).rejects.toThrow('at least a header row and one data row')
    })
  })

  // -------------------------------------------------------------------------
  // jsonToCsv()
  // -------------------------------------------------------------------------

  describe('jsonToCsv()', () => {
    it('converts JSON array to CSV', async () => {
      const json = JSON.stringify([{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }])
      const result = parseResult(await dataTransformTool.execute({
        action: 'jsonToCsv', json,
      })) as { csv: string }
      expect(result.csv).toContain('name,age')
      expect(result.csv).toContain('Alice,30')
      expect(result.csv).toContain('Bob,25')
    })

    it('escapes fields containing commas', async () => {
      const json = JSON.stringify([{ name: 'Alice, Jr.', age: 30 }])
      const result = parseResult(await dataTransformTool.execute({
        action: 'jsonToCsv', json,
      })) as { csv: string }
      expect(result.csv).toContain('"Alice, Jr."')
    })

    it('rejects non-array JSON', async () => {
      await expect(
        dataTransformTool.execute({ action: 'jsonToCsv', json: '{"a":1}' }),
      ).rejects.toThrow('array of objects')
    })

    it('rejects empty array', async () => {
      await expect(
        dataTransformTool.execute({ action: 'jsonToCsv', json: '[]' }),
      ).rejects.toThrow('must not be empty')
    })
  })

  // -------------------------------------------------------------------------
  // yamlToJson()
  // -------------------------------------------------------------------------

  describe('yamlToJson()', () => {
    it('parses simple key-value YAML', async () => {
      const yaml = 'name: Alice\nage: 30\nactive: true'
      const result = parseResult(await dataTransformTool.execute({
        action: 'yamlToJson', yaml,
      })) as { data: Record<string, unknown> }
      expect(result.data).toEqual({ name: 'Alice', age: 30, active: true })
    })

    it('parses nested YAML', async () => {
      const yaml = 'person:\n  name: Alice\n  age: 30'
      const result = parseResult(await dataTransformTool.execute({
        action: 'yamlToJson', yaml,
      })) as { data: { person: Record<string, unknown> } }
      expect(result.data.person).toEqual({ name: 'Alice', age: 30 })
    })

    it('parses YAML arrays', async () => {
      const yaml = '- one\n- two\n- three'
      const result = parseResult(await dataTransformTool.execute({
        action: 'yamlToJson', yaml,
      })) as { data: string[] }
      expect(result.data).toEqual(['one', 'two', 'three'])
    })

    it('parses null and boolean values', async () => {
      const yaml = 'a: null\nb: true\nc: false\nd: ~'
      const result = parseResult(await dataTransformTool.execute({
        action: 'yamlToJson', yaml,
      })) as { data: Record<string, unknown> }
      expect(result.data['a']).toBeNull()
      expect(result.data['b']).toBe(true)
      expect(result.data['c']).toBe(false)
      expect(result.data['d']).toBeNull()
    })

    it('parses quoted strings', async () => {
      const yaml = 'name: "true"\nvalue: \'42\''
      const result = parseResult(await dataTransformTool.execute({
        action: 'yamlToJson', yaml,
      })) as { data: Record<string, unknown> }
      expect(result.data['name']).toBe('true')
      expect(result.data['value']).toBe('42')
    })

    it('skips comments', async () => {
      const yaml = '# This is a comment\nname: Alice\n# Another comment\nage: 30'
      const result = parseResult(await dataTransformTool.execute({
        action: 'yamlToJson', yaml,
      })) as { data: Record<string, unknown> }
      expect(result.data).toEqual({ name: 'Alice', age: 30 })
    })
  })

  // -------------------------------------------------------------------------
  // jsonToYaml()
  // -------------------------------------------------------------------------

  describe('jsonToYaml()', () => {
    it('converts simple object to YAML', async () => {
      const json = JSON.stringify({ name: 'Alice', age: 30 })
      const result = parseResult(await dataTransformTool.execute({
        action: 'jsonToYaml', json,
      })) as { yaml: string }
      expect(result.yaml).toContain('name: Alice')
      expect(result.yaml).toContain('age: 30')
    })

    it('converts array to YAML', async () => {
      const json = JSON.stringify(['one', 'two', 'three'])
      const result = parseResult(await dataTransformTool.execute({
        action: 'jsonToYaml', json,
      })) as { yaml: string }
      expect(result.yaml).toContain('- one')
      expect(result.yaml).toContain('- two')
    })

    it('handles nested objects', async () => {
      const json = JSON.stringify({ person: { name: 'Alice' } })
      const result = parseResult(await dataTransformTool.execute({
        action: 'jsonToYaml', json,
      })) as { yaml: string }
      expect(result.yaml).toContain('person:')
      expect(result.yaml).toContain('  name: Alice')
    })

    it('handles null and boolean', async () => {
      const json = JSON.stringify({ a: null, b: true, c: false })
      const result = parseResult(await dataTransformTool.execute({
        action: 'jsonToYaml', json,
      })) as { yaml: string }
      expect(result.yaml).toContain('a: null')
      expect(result.yaml).toContain('b: true')
      expect(result.yaml).toContain('c: false')
    })
  })

  // -------------------------------------------------------------------------
  // xmlToJson()
  // -------------------------------------------------------------------------

  describe('xmlToJson()', () => {
    it('parses simple XML', async () => {
      const xml = '<root><name>Alice</name><age>30</age></root>'
      const result = parseResult(await dataTransformTool.execute({
        action: 'xmlToJson', xml,
      })) as { data: { root: { name: string; age: string } } }
      expect(result.data.root.name).toBe('Alice')
      expect(result.data.root.age).toBe('30')
    })

    it('handles XML attributes', async () => {
      const xml = '<item id="1">test</item>'
      const result = parseResult(await dataTransformTool.execute({
        action: 'xmlToJson', xml,
      })) as { data: { item: { id: string; '#text': string } } }
      expect(result.data.item.id).toBe('1')
      expect(result.data.item['#text']).toBe('test')
    })

    it('handles self-closing tags', async () => {
      const xml = '<root><empty/></root>'
      const result = parseResult(await dataTransformTool.execute({
        action: 'xmlToJson', xml,
      })) as { data: { root: { empty: unknown } } }
      expect(result.data.root).toHaveProperty('empty')
    })

    it('decodes XML entities', async () => {
      const xml = '<text>&amp; &lt; &gt; &quot; &apos;</text>'
      const result = parseResult(await dataTransformTool.execute({
        action: 'xmlToJson', xml,
      })) as { data: { text: string } }
      expect(result.data.text).toBe('& < > " \'')
    })

    it('strips DOCTYPE (XXE protection)', async () => {
      const xml = '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root>&xxe;</root>'
      // Should not expand the entity — DOCTYPE is stripped
      const result = parseResult(await dataTransformTool.execute({
        action: 'xmlToJson', xml,
      })) as { data: { root: string } }
      expect(result.data.root).not.toContain('/etc/passwd')
    })

    it('handles CDATA sections', async () => {
      const xml = '<text><![CDATA[Hello World]]></text>'
      const result = parseResult(await dataTransformTool.execute({
        action: 'xmlToJson', xml,
      })) as { data: { text: string } }
      expect(result.data.text).toBe('Hello World')
    })
  })

  // -------------------------------------------------------------------------
  // tableToJson()
  // -------------------------------------------------------------------------

  describe('tableToJson()', () => {
    it('parses markdown table', async () => {
      const table = '| name | age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |'
      const result = parseResult(await dataTransformTool.execute({
        action: 'tableToJson', table,
      })) as { data: Record<string, string>[]; rows: number }
      expect(result.rows).toBe(2)
      expect(result.data[0]).toEqual({ name: 'Alice', age: '30' })
    })

    it('rejects table without separator', async () => {
      await expect(
        dataTransformTool.execute({ action: 'tableToJson', table: '| name |' }),
      ).rejects.toThrow('at least a header and separator')
    })
  })

  // -------------------------------------------------------------------------
  // jsonToTable()
  // -------------------------------------------------------------------------

  describe('jsonToTable()', () => {
    it('converts JSON to markdown table', async () => {
      const json = JSON.stringify([{ name: 'Alice', age: 30 }])
      const result = parseResult(await dataTransformTool.execute({
        action: 'jsonToTable', json,
      })) as { table: string }
      expect(result.table).toContain('| name | age |')
      expect(result.table).toContain('| --- | --- |')
      expect(result.table).toContain('| Alice | 30 |')
    })

    it('rejects empty array', async () => {
      await expect(
        dataTransformTool.execute({ action: 'jsonToTable', json: '[]' }),
      ).rejects.toThrow('must not be empty')
    })
  })

  // -------------------------------------------------------------------------
  // Exported functions
  // -------------------------------------------------------------------------

  describe('parseCsv()', () => {
    it('handles CRLF line endings', () => {
      const rows = parseCsv('a,b\r\n1,2\r\n')
      expect(rows).toEqual([['a', 'b'], ['1', '2']])
    })

    it('handles empty fields', () => {
      const rows = parseCsv('a,,b\n1,,2')
      expect(rows[0]).toEqual(['a', '', 'b'])
    })
  })

  describe('parseYaml()', () => {
    it('parses scalar values', () => {
      expect(parseYaml('42')).toBe(42)
    })

    it('parses empty input as null', () => {
      expect(parseYaml('')).toBeNull()
    })
  })

  describe('parseXml()', () => {
    it('handles XML declaration', () => {
      const result = parseXml('<?xml version="1.0"?><root>text</root>')
      expect(result).toEqual({ root: 'text' })
    })
  })

  describe('decodeXmlEntities()', () => {
    it('only decodes 5 built-in entities', () => {
      const result = decodeXmlEntities('&amp; &lt; &gt; &quot; &apos; &custom;')
      expect(result).toBe('& < > " \' &custom;')
    })
  })

  // -------------------------------------------------------------------------
  // Argument validation
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(dataTransformTool.execute(null)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects non-object args', async () => {
      await expect(dataTransformTool.execute('string')).rejects.toThrow('Arguments must be an object')
    })

    it('rejects unknown action', async () => {
      await expect(
        dataTransformTool.execute({ action: 'hack' }),
      ).rejects.toThrow('action must be')
    })

    it('rejects csvToJson without csv', async () => {
      await expect(
        dataTransformTool.execute({ action: 'csvToJson' }),
      ).rejects.toThrow('"csv" string')
    })

    it('rejects yamlToJson without yaml', async () => {
      await expect(
        dataTransformTool.execute({ action: 'yamlToJson' }),
      ).rejects.toThrow('"yaml" string')
    })

    it('rejects xmlToJson without xml', async () => {
      await expect(
        dataTransformTool.execute({ action: 'xmlToJson' }),
      ).rejects.toThrow('"xml" string')
    })
  })

  // -------------------------------------------------------------------------
  // Security — source code audit
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no code-execution patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, [])
    })
  })
})
