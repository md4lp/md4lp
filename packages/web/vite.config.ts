import { defineConfig } from 'vite'

/**
 * The web app is a pure CLIENT now: it no longer embeds the API or touches git. The standalone
 * `@md4lp/server` owns the repo; Vite just serves the UI and proxies `/api` (and, from T4b, `/mcp`)
 * to it. This keeps a single repo writer (D18). Server URL overridable via MD4LP_SERVER.
 */

const server = process.env.MD4LP_SERVER ?? 'http://localhost:8787'

export default defineConfig({
  // Crepe edits code blocks with CodeMirror, which breaks ("Cannot read properties of undefined
  // (reading 'extension')") if more than one copy of @codemirror/state|view is bundled. Force a single
  // instance so all extensions share one module identity.
  resolve: {
    dedupe: ['@codemirror/state', '@codemirror/view'],
  },
  server: {
    proxy: {
      '/api': server,
      '/mcp': server,
    },
  },
})
