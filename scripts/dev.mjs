// Dev orchestrator: run the standalone @md4lp/server AND the Vite web client together, so `pnpm dev`
// stays a single command. The server owns the repo (D18); Vite proxies /api + /mcp to it.
//
// We invoke the local binaries directly (node_modules/.bin) rather than `pnpm run`, to bypass pnpm's
// per-command deps-status check and keep startup fast and quiet.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const bin = (name) => fileURLToPath(new URL(`../node_modules/.bin/${name}`, import.meta.url))

// MD4LP_WEB_PORT lets a parallel stack (e.g. the Playwright e2e run) put Vite on its own port so it
// never clashes with a developer's `pnpm dev`. The server port is already env-driven (MD4LP_PORT), and
// vite.config reads MD4LP_SERVER for the proxy target — so an isolated stack is purely env-configured.
const viteArgs = ['packages/web']
if (process.env.MD4LP_WEB_PORT) viteArgs.push('--port', process.env.MD4LP_WEB_PORT, '--strictPort')

const procs = [
  { name: 'server', cmd: bin('tsx'), args: ['packages/server/src/bin.ts'] },
  { name: 'web', cmd: bin('vite'), args: viteArgs },
]

const children = procs.map(({ name, cmd, args }) => {
  const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', env: process.env })
  child.on('exit', (code) => {
    console.log(`[dev] ${name} exited (${code}); shutting down`)
    shutdown()
  })
  return child
})

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) c.kill('SIGTERM')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
