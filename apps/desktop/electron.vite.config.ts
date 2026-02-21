import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { builtinModules } from 'module'

// Module die NUR per dynamischem import() geladen werden (webpackIgnore).
// Graceful failure wenn nicht installiert.
const DYNAMIC_ONLY_EXTERNALS = [
  'sharp',
  'tesseract.js',
  'playwright',
  'whatsapp-web.js',
  'puppeteer',
  'pdf-lib',
  'pdf-parse',
]

export default defineConfig({
  main: {
    plugins: [],
    resolve: {
      alias: [
        { find: /^@ki-assistent\/shared$/, replacement: resolve(__dirname, '../../packages/shared/src/index.ts') },
        { find: /^@ki-assistent\/tools$/, replacement: resolve(__dirname, '../../packages/tools/src/index.ts') },
        { find: /^@ki-assistent\/tools\/(.*)$/, replacement: resolve(__dirname, '../../packages/tools/src/$1') }
      ]
    },
    build: {
      // electron-vite v5 externalisiert per Default alle deps.
      // Wir deaktivieren das und steuern selbst was extern bleibt.
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        },
        external: [
          'electron',
          ...builtinModules,
          ...builtinModules.map(m => `node:${m}`),
          ...DYNAMIC_ONLY_EXTERNALS,
        ],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
