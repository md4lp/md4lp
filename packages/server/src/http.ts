import { Hono } from 'hono'
import type { Api } from './api'

/**
 * Thin HTTP layer over the framework-agnostic `Api.handle`. This is the ONLY place that knows about
 * HTTP; the handler itself stays transport-neutral so the same `createApi` instance also backs the MCP
 * endpoint (T4b) in the same process — keeping a single repo writer (D18).
 */

const DEFAULT_USER = 'alice'

export function createHttpApp(api: Api): Hono {
  const app = new Hono()

  // SSE live-events stream (D20). Registered before the JSON catch-all so it isn't swallowed by it.
  // The handler returns a streaming Response directly (not via api.handle, which is JSON-only).
  app.get('/api/events', (c) => {
    const encoder = new TextEncoder()
    let unsubscribe = () => {}
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (chunk: string): void => {
          try {
            controller.enqueue(encoder.encode(chunk))
          } catch {
            /* client gone — cancel() will clean up */
          }
        }
        send(': connected\n\n') // open the stream immediately so EventSource fires `onopen`
        unsubscribe = api.subscribe((e) => send(`data: ${JSON.stringify(e)}\n\n`))
        heartbeat = setInterval(() => send(': ping\n\n'), 25_000) // keep proxies from idling us out
      },
      cancel() {
        unsubscribe()
        if (heartbeat) clearInterval(heartbeat)
      },
    })
    return new Response(stream, {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
    })
  })

  app.all('/api/*', async (c) => {
    const url = new URL(c.req.url)
    const method = c.req.method

    // Check for Bearer token, x-md4lp-session header, or cookie
    const authHeader = c.req.header('authorization')
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined
    const sessionToken = bearerToken ?? c.req.header('x-md4lp-session') ?? getCookie(c.req.header('cookie'), 'md4lp_session')

    let authContext: import('./api').AuthContext | undefined
    let user = url.searchParams.get('user') ?? c.req.header('x-md4lp-user')

    const clientId = c.req.header('x-md4lp-client-id') ?? url.searchParams.get('clientId') ?? undefined

    if (sessionToken) {
      if (sessionToken.startsWith('md4lp_agt_')) {
        const agentResult = await api.auth.validateAgentToken(sessionToken)
        if (agentResult) {
          authContext = {
            token: sessionToken,
            userId: agentResult.user.id,
            email: agentResult.user.defaultEmail,
            name: `${agentResult.user.name} (via ${agentResult.session.agentName})`,
            clientId,
            agentSession: agentResult.session,
          }
          if (!user) {
            user = agentResult.user.username || agentResult.user.name || agentResult.user.id
          }
        }
      } else {
        const authResult = await api.auth.authenticateToken(sessionToken)
        if (authResult) {
          authContext = {
            token: sessionToken,
            userId: authResult.user.id,
            email: authResult.currentEmail,
            name: authResult.user.name,
            clientId,
          }
          if (!user) {
            user = authResult.user.name || authResult.user.defaultEmail || authResult.user.id
          }
        }
      }
    } else if (clientId) {
      authContext = { clientId }
    }

    user = user ?? DEFAULT_USER
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? await c.req.json().catch(() => ({})) : undefined
    try {
      const result = await api.handle(method, url.pathname, url.searchParams, body, user, authContext)
      return jsonResponse(result.status, result.json)
    } catch (err) {
      // Log the full error (incl. stack) server-side, but never return the stack to the client.
      console.error(`[md4lp] ${method} ${url.pathname} failed:`, err)
      return jsonResponse(500, { error: err instanceof Error ? err.message : String(err) })
    }
  })

  return app
}

function getCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined
  const match = cookieHeader.match(new RegExp(`(^|;\\s*)${name}=([^;]*)`))
  return match && match[2] ? decodeURIComponent(match[2]) : undefined
}



// Build the JSON Response directly (instead of Hono's typed c.json) so any numeric status is accepted.
function jsonResponse(status: number, json: unknown): Response {
  return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })
}
