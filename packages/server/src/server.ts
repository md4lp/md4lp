import { serve } from '@hono/node-server'
import { createApi, type Api } from './api'
import { createHttpApp } from './http'
import { mountMcp } from './mcp'
import type { Config } from './config'

/**
 * @md4lp/server — the standalone process that OWNS the repo (D18 single-writer). The web app and, from
 * T4b, MCP agents are clients of this one process, so the in-process mutexes in @md4lp/repo and
 * @md4lp/comments remain the single serialization point.
 */

export interface ServerOptions {
  /** Path to the git working directory the server manages. */
  repoDir: string
  /** TCP port to listen on. */
  port?: number
  /** Loaded config (users, roles, emails). Defaults to DEFAULT_CONFIG when omitted. */
  config?: Config
}

export interface Server {
  /** The framework-agnostic API handler (shared with the future MCP endpoint). */
  api: Api
  /** Start listening; returns the underlying Node server handle. */
  listen(): ReturnType<typeof serve>
}

export const DEFAULT_PORT = 8787

export async function createServer(opts: ServerOptions): Promise<Server> {
  const api = createApi(opts.repoDir, opts.config)
  const app = createHttpApp(api)
  await mountMcp(app, api)              // /mcp — same process, same api instance (D18)
  const port = opts.port ?? DEFAULT_PORT
  return {
    api,
    listen: () => serve({ fetch: app.fetch, port }),
  }
}
