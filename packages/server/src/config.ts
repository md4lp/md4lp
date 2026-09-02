import { readFile } from 'node:fs/promises'
import { z } from 'zod'

const UserConfigSchema = z.object({
  role: z.enum(['editor', 'commenter']),
  email: z.string().optional(),
})

export const ConfigSchema = z.object({
  repoDir: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  appUrl: z.string().optional(),
  /** Edit-lock idle timeout (ms): no interaction for this long lets another editor take over (D20). */
  lockTimeoutMs: z.number().int().positive().optional(),
  users: z.record(z.string(), UserConfigSchema).default({}),
})

export type Config = z.infer<typeof ConfigSchema>

export function getAppUrl(config?: Config): string {
  return (process.env.MD4LP_APP_URL || config?.appUrl || 'http://localhost:5173').replace(/\/+$/, '')
}

export const DEFAULT_CONFIG: Config = {
  appUrl: 'http://localhost:5173',
  users: {
    alice: { role: 'editor', email: 'alice@md4lp.local' },
    bob: { role: 'commenter', email: 'bob@md4lp.local' },
    'agent-claude': { role: 'editor', email: 'agent@md4lp.local' },
  },
}

/**
 * Load config from:
 *   1. explicit path argument
 *   2. MD4LP_CONFIG env var
 *   3. ./md4lp.config.json in cwd
 *   4. DEFAULT_CONFIG (if file not found)
 *
 * Throws on malformed JSON or invalid schema — fail loudly rather than silently ignoring bad config.
 */
export async function loadConfig(configPath?: string): Promise<Config> {
  const resolved = configPath ?? process.env.MD4LP_CONFIG ?? './md4lp.config.json'
  try {
    const raw = JSON.parse(await readFile(resolved, 'utf8'))
    return ConfigSchema.parse(raw)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_CONFIG
    throw err
  }
}
