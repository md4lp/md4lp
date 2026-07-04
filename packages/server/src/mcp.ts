import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Api } from './api'
import { commentFields, putFileFields, suggestionRefFields } from './schemas'

/** Repo-relative file path — carried in the MCP tool body (REST carries it in the query string). */
const pathField = z.string().describe('Repo-relative path, e.g. "welcome.md"')

/**
 * MCP endpoint for @md4lp/server (T4b, D8).
 *
 * The agent is a first-class user: it reads files and writes .md edits via these tools. Under D20 a
 * write is a self-contained edit turn (acquire the edit lock → write the edit branch → release →
 * consolidate to main), so the agent respects the one-editor-at-a-time rule and lands on main like a
 * human's published edit. Comments live on the creator's `comments/<user>` branch (D17).
 *
 * Mounted at /mcp on the SAME Hono app as /api (D18: one process, one repo owner, one mutex).
 * All tools delegate to the shared `Api.handle` instance — no direct git access from here.
 * Uses WebStandardStreamableHTTPServerTransport (Web Request/Response API) — no Node.js bridging.
 *
 * Identity: the agent user is declared in config; for Stage 1 it defaults to 'agent-claude' with
 * role 'editor' so it can read AND write .md files on its branch.
 */

export const DEFAULT_AGENT_USER = 'agent-claude'

export async function mountMcp(app: Hono, api: Api, agentUser = DEFAULT_AGENT_USER): Promise<void> {
  const server = new McpServer({ name: 'md4lp', version: '0.1.0' })

  // Helper: call the API handler as the agent user, throw on HTTP errors.
  const call = async (method: string, path: string, params: Record<string, string> = {}, body?: unknown) => {
    const q = new URLSearchParams({ user: agentUser, ...params })
    const res = await api.handle(method, `/api/${path}`, q, body, agentUser)
    if (res.status >= 400) throw new Error((res.json as Record<string, unknown>)?.error as string ?? `API error ${res.status}`)
    return res.json
  }

  // ── list_files ────────────────────────────────────────────────────────────────
  server.tool('list_files', 'List all Markdown files in the workspace the agent can read or edit.', {},
    async () => {
      const state = await call('GET', 'state') as { files: string[]; branch: string }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ branch: state.branch, files: state.files }) }] }
    },
  )

  // ── read_file ─────────────────────────────────────────────────────────────────
  server.tool('read_file', 'Read the current content of a Markdown file (the live version: the in-progress edit if someone is editing, else the consolidated main).',
    { path: pathField },
    async ({ path }) => {
      const result = await call('GET', 'file', { path }) as { content: string }
      return { content: [{ type: 'text' as const, text: result.content }] }
    },
  )

  // ── write_file ────────────────────────────────────────────────────────────────
  server.tool('write_file',
    'Write (overwrite) a Markdown file. Content is canonicalized and committed to main. Use read_file first. Fails if a human is currently editing the file (one editor at a time).',
    { path: pathField, ...putFileFields },
    async ({ path, content, message }) => {
      // D20: writes flow through the edit lock. The agent does a self-contained edit turn —
      // acquire → write to the edit branch → release (consolidate to main) — so it behaves as one
      // discrete edit and respects the one-editor-at-a-time rule (acquire throws if a human holds it).
      await call('POST', 'lock/acquire', { path })
      let oid: string
      try {
        oid = ((await call('PUT', 'file', { path }, { content, message: message ?? `agent: edit ${path}` })) as { oid: string }).oid
      } finally {
        await call('POST', 'lock/release', { path })
      }
      return { content: [{ type: 'text' as const, text: `committed ${String(oid).slice(0, 7)}` }] }
    },
  )

  // ── list_comments ─────────────────────────────────────────────────────────────
  server.tool('list_comments', 'List all open comments and suggestions on a file (from all users, re-anchored).',
    { path: pathField },
    async ({ path }) => {
      const result = await call('GET', 'comments', { path }) as { comments: unknown[] }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.comments, null, 2) }] }
    },
  )

  // ── add_comment ───────────────────────────────────────────────────────────────
  server.tool('add_comment', 'Add a comment (or suggestion) anchored to a text range in a file.',
    { path: pathField, ...commentFields },
    async ({ path, start, end, body, suggestion }) => {
      const result = await call('POST', 'comment', { path }, { start, end, body, suggestion }) as { comment: { id: string } }
      return { content: [{ type: 'text' as const, text: `comment ${result.comment.id}` }] }
    },
  )

  // ── resolve_comment ───────────────────────────────────────────────────────────
  server.tool('resolve_comment', 'Mark a comment as resolved on the creator\'s branch.',
    { ...suggestionRefFields, path: pathField },
    async ({ commentId, owner, path }) => {
      await call('POST', 'suggestion/reject', { path }, { commentId, owner })
      return { content: [{ type: 'text' as const, text: `resolved ${commentId}` }] }
    },
  )

  // ── Mount WebStandard transport at /mcp ───────────────────────────────────────
  // Single transport instance connected once at startup; all MCP requests go through it.
  // The transport manages sessions internally (one session per MCP client connection).
  // WebStandardStreamableHTTPServerTransport uses the Web Request/Response API — Hono-native.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  })
  await server.connect(transport)

  app.all('/mcp', (c) => transport.handleRequest(c.req.raw))
}
