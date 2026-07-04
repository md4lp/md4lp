import { fileURLToPath } from 'node:url'
import { createServer, DEFAULT_PORT } from './server'
import { loadConfig } from './config'

/**
 * CLI entry — run via `tsx` (see root `server`/`dev` scripts).
 *
 * Config resolution order (highest → lowest priority):
 *   MD4LP_REPO             override repoDir from config / default
 *   MD4LP_PORT             override port from config / default
 *   MD4LP_LOCK_TIMEOUT_MS  override the edit-lock idle timeout (D20; e2e uses a short value)
 *   MD4LP_CONFIG           path to a md4lp.config.json (default: ./md4lp.config.json in cwd)
 *
 * If no config file is found, the built-in defaults are used (alice/bob/agent-claude).
 */

const loaded = await loadConfig()
const repoDir = process.env.MD4LP_REPO ?? loaded.repoDir ?? fileURLToPath(new URL('../../web/.sample-repo', import.meta.url))
const port = Number(process.env.MD4LP_PORT ?? loaded.port ?? DEFAULT_PORT)
const config = process.env.MD4LP_LOCK_TIMEOUT_MS
  ? { ...loaded, lockTimeoutMs: Number(process.env.MD4LP_LOCK_TIMEOUT_MS) }
  : loaded

const server = await createServer({ repoDir, port, config })
server.listen()
console.log(`md4lp server listening on http://localhost:${port}  (repo: ${repoDir})`)
