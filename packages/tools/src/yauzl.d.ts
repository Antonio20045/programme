declare module 'yauzl' {
  import type { EventEmitter } from 'node:events'

  interface Entry {
    readonly fileName: string
    readonly uncompressedSize: number
    readonly compressedSize: number
    readonly externalFileAttributes: number
    readonly comment: string
  }

  interface ZipFile extends EventEmitter {
    readonly entryCount: number
    readEntry(): void
    openReadStream(
      entry: Entry,
      callback: (err: Error | null, stream?: NodeJS.ReadableStream) => void,
    ): void
    close(): void
    on(event: 'entry', listener: (entry: Entry) => void): this
    on(event: 'end', listener: () => void): this
    on(event: 'error', listener: (err: Error) => void): this
  }

  interface OpenOptions {
    lazyEntries?: boolean
    autoClose?: boolean
    decodeStrings?: boolean
    validateEntrySizes?: boolean
    strictFileNames?: boolean
  }

  function open(
    path: string,
    options: OpenOptions,
    callback: (err: Error | null, zipfile?: ZipFile) => void,
  ): void

  function open(
    path: string,
    callback: (err: Error | null, zipfile?: ZipFile) => void,
  ): void

  function validateFileName(fileName: string): string | null
}
