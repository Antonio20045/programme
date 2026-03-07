import { defineConfig } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { builtinModules } from 'module'

// Load .env from apps/desktop/ (empty prefix = load ALL vars, not just VITE_)
const env = loadEnv('production', __dirname, '')

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
    define: {
      'process.env.CLERK_PUBLISHABLE_KEY': JSON.stringify(process.env.CLERK_PUBLISHABLE_KEY || env['CLERK_PUBLISHABLE_KEY'] || ''),
      // DEFAULT_GATEWAY_URL must NOT be baked in — it forces server mode for all users.
      // Server mode is configured via ~/.openclaw/openclaw.json instead.
      'process.env.DEFAULT_GATEWAY_URL': JSON.stringify(''),
      'process.env.GOOGLE_OAUTH_CLIENT_ID': JSON.stringify(process.env.GOOGLE_OAUTH_CLIENT_ID || env['GOOGLE_OAUTH_CLIENT_ID'] || ''),
      'process.env.GOOGLE_OAUTH_CLIENT_SECRET': JSON.stringify(process.env.GOOGLE_OAUTH_CLIENT_SECRET || env['GOOGLE_OAUTH_CLIENT_SECRET'] || ''),
      'process.env.CLERK_SECRET_KEY': JSON.stringify(process.env.CLERK_SECRET_KEY || env['CLERK_SECRET_KEY'] || ''),
      'process.env.GH_TOKEN_UPDATER': JSON.stringify(process.env.GH_TOKEN_UPDATER || env['GH_TOKEN_UPDATER'] || ''),
    },
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
          'better-sqlite3',
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
