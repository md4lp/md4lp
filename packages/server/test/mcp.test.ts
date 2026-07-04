/**
 * T6 — AI-as-user acceptance test.
 *
 * A scripted agent exercises the MCP endpoint over the real StreamableHTTP protocol against a
 * live server started on an OS-assigned port. Verifies the full path:
 *   MCP write_file → commit on wip/agent-claude → MCP read_file returns updated content
 *   MCP add_comment → comment visible via REST /api/comments
 *
 * This is the automated "scripted stand-in" for the live OpenCode demo (see AGENTS.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve, type ServerType } from '@hono/node-server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { AddressInfo } from 'node:net'
import { createApi } from '../src/api'
import { createHttpApp } from '../src/http'
import { mountMcp } from '../src/mcp'
import { DEFAULT_CONFIG } from '../src/config'

// ---------------------------------------------------------------------------
// Helper — spin up a full (HTTP + MCP) server on a free port
// ---------------------------------------------------------------------------

interface TestServer {
  port: number
  client: Client
  stop: () => Promise<void>
}

async function startTestServer(repoDir: string): Promise<TestServer> {
  const api = createApi(repoDir, DEFAULT_CONFIG)
  const app = createHttpApp(api)
  await mountMcp(app, api)

  let nodeServer!: ServerType
  const port = await new Promise<number>((resolve, reject) => {
    nodeServer = serve({ fetch: app.fetch, port: 0 }, (info: AddressInfo) => resolve(info.port))
    nodeServer.on('error', reject)
  })

  const client = new Client({ name: 'test-agent', version: '0.0.1' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`))
  await client.connect(transport)

  const stop = (): Promise<void> =>
    client.close().catch(() => {}).then(
      () => new Promise<void>((res, rej) => nodeServer.close((err) => (err ? rej(err) : res()))),
    )

  return { port, client, stop }
}

const text = (result: Awaited<ReturnType<Client['callTool']>>): string =>
  (result.content as Array<{ type: string; text: string }>)[0]!.text

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@md4lp/server MCP (T6 AI-as-user)', () => {
  let ts: TestServer

  beforeEach(async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'md4lp-mcp-'))
    ts = await startTestServer(repoDir)
  })

  afterEach(async () => {
    await ts.stop()
  })

  it('list_files returns the seeded docs', async () => {
    const result = await ts.client.callTool({ name: 'list_files', arguments: {} })
    const data = JSON.parse(text(result)) as { branch: string; files: string[] }
    expect(data.files).toContain('welcome.md')
    expect(data.files).toContain('scope.md')
    expect(data.branch).toBe('main') // D20: files are served from the consolidated truth, not a per-user branch
  })

  it('write_file consolidates to main (self-contained edit turn); read_file returns the updated content', async () => {
    const NEW_CONTENT = '# Agent edit\n\nHello from the agent.\n'
    const write = await ts.client.callTool({ name: 'write_file', arguments: { path: 'welcome.md', content: NEW_CONTENT, message: 'agent: test edit' } })
    expect(text(write)).toMatch(/^committed [0-9a-f]{7}/)

    const read = await ts.client.callTool({ name: 'read_file', arguments: { path: 'welcome.md' } })
    expect(text(read)).toContain('# Agent edit')
    expect(text(read)).toContain('Hello from the agent.')
  })

  it('add_comment creates a comment visible via the REST API', async () => {
    const comment = await ts.client.callTool({ name: 'add_comment', arguments: { path: 'welcome.md', start: 0, end: 9, body: 'agent comment' } })
    expect(text(comment)).toMatch(/^comment /)

    // Verify via REST — alice's view aggregates all users including agent-claude
    const res = await fetch(`http://localhost:${ts.port}/api/comments?user=alice&path=welcome.md`)
    const data = await res.json() as { comments: Array<{ comment: { body: string }; owner: string }> }
    const agentComment = data.comments.find((c) => c.owner === 'agent-claude')
    expect(agentComment?.comment.body).toBe('agent comment')
  })
})
