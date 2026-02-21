import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@ki-assistent/tools': path.resolve(__dirname, 'packages/tools/src'),
      '@ki-assistent/shared': path.resolve(__dirname, 'packages/shared/src'),
    },
  },
  test: {
    passWithNoTests: true,
    exclude: ['packages/gateway/**', 'apps/mobile/**', '**/node_modules/**'],
  },
})
