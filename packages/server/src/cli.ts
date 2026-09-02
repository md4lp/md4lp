import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Api } from './api'
import { createMcpServer } from './mcp'

export interface AgentAuthConfig {
  serverUrl: string
  token: string
  tokenPrefix: string
  agentName: string
  projectScopes: Array<{ projectId: string; maxRole: string }>
  idleTimeoutMs: number
  absoluteExpiresAt: number
  savedAt: number
}

function getAuthConfigPath(): string {
  const configDir = join(homedir(), '.config', 'md4lp')
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 })
  }
  return join(configDir, 'agent-auth.json')
}

export function loadAgentAuth(): AgentAuthConfig | null {
  try {
    const p = getAuthConfigPath()
    if (!existsSync(p)) return null
    const data = JSON.parse(readFileSync(p, 'utf-8'))
    return data
  } catch {
    return null
  }
}

export function saveAgentAuth(auth: AgentAuthConfig): void {
  const p = getAuthConfigPath()
  writeFileSync(p, JSON.stringify(auth, null, 2), { mode: 0o600 })
}

export function clearAgentAuth(): boolean {
  try {
    const p = getAuthConfigPath()
    if (existsSync(p)) {
      unlinkSync(p)
      return true
    }
    return false
  } catch {
    return false
  }
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "${url}"` : `xdg-open "${url}"`
  exec(cmd, () => {})
}

export async function loginWithLoopback(options?: {
  serverUrl?: string
  appUrl?: string
  agentName?: string
  port?: number
}): Promise<AgentAuthConfig> {
  const serverUrl = (options?.serverUrl || process.env.MD4LP_SERVER_URL || 'http://localhost:8787').replace(/\/+$/, '')
  const appUrl = (options?.appUrl || process.env.MD4LP_APP_URL || 'http://localhost:5173').replace(/\/+$/, '')
  const agentName = options?.agentName || 'md4lp CLI'

  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  const state = randomBytes(16).toString('base64url')

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1')
        if (reqUrl.pathname === '/callback') {
          const code = reqUrl.searchParams.get('code')
          const returnedState = reqUrl.searchParams.get('state')

          if (!code || returnedState !== state) {
            res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
            res.end('<h1>400 Bad Request</h1><p>Invalid authorization code or state parameter.</p>')
            return
          }

          // Exchange code for token with server
          const tokenRes = await fetch(`${serverUrl}/api/auth/agent-token`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code, codeVerifier }),
          })

          if (!tokenRes.ok) {
            const errBody = await tokenRes.json().catch(() => ({}))
            res.writeHead(tokenRes.status, { 'content-type': 'text/html; charset=utf-8' })
            res.end(`<h1>Authentication Failed</h1><p>${(errBody as any).error || 'Token exchange failed'}</p>`)
            return
          }

          const tokenData = await tokenRes.json()
          const authConfig: AgentAuthConfig = {
            serverUrl,
            token: tokenData.token,
            tokenPrefix: tokenData.tokenPrefix,
            agentName: tokenData.agentName || agentName,
            projectScopes: tokenData.projectScopes || [],
            idleTimeoutMs: tokenData.idleTimeoutMs,
            absoluteExpiresAt: tokenData.absoluteExpiresAt,
            savedAt: Date.now(),
          }

          saveAgentAuth(authConfig)

          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><title>md4lp — Authorization Successful</title></head>
              <body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 90vh; background: #0f172a; color: #f8fafc;">
                <div style="text-align: center; padding: 2rem; background: #1e293b; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
                  <h1 style="color: #38bdf8; margin-bottom: 0.5rem;">Authorization Successful!</h1>
                  <p style="color: #94a3b8; font-size: 1.1rem;">Your AI agent has been connected to md4lp.</p>
                  <p style="color: #64748b; font-size: 0.9rem;">You can now close this tab and return to your terminal.</p>
                </div>
              </body>
            </html>
          `)

          setTimeout(() => {
            server.close(() => resolve(authConfig))
          }, 500)
        } else {
          res.writeHead(404)
          res.end()
        }
      } catch (err) {
        reject(err)
      }
    })

    server.listen(options?.port || 0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      const authUrl = `${appUrl}/#authorize-agent?port=${port}&name=${encodeURIComponent(agentName)}&challenge=${encodeURIComponent(codeChallenge)}&state=${encodeURIComponent(state)}`
      openBrowser(authUrl)
    })

    // Timeout after 3 minutes
    setTimeout(() => {
      server.close(() => reject(new Error('Authorization timed out after 3 minutes')))
    }, 180_000)
  })
}

export async function runMcpStdio(api: Api): Promise<void> {
  const auth = loadAgentAuth()
  const agentUser = auth?.agentName || 'agent-claude'
  const server = createMcpServer(api, agentUser)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
