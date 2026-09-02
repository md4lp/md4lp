import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Api } from './api'
import { commentFields, putFileFields, suggestionRefFields } from './schemas'

/** Repo-relative file path — carried in the MCP tool body (REST carries it in the query string). */
const pathField = z.string().describe('Repo-relative path, e.g. "welcome.md"')
const projectIdField = z.string().describe('Target project ID').optional()

export const DEFAULT_AGENT_USER = 'agent-claude'

export function createMcpServer(api: Api, defaultAgentUser = DEFAULT_AGENT_USER): McpServer {
  const server = new McpServer({ name: 'md4lp', version: '0.2.0' })

  // Helper: call the API handler as the agent user or authenticated context
  const call = async (
    method: string,
    path: string,
    params: Record<string, string> = {},
    body?: unknown,
    user = defaultAgentUser,
  ) => {
    const q = new URLSearchParams({ user, ...params })
    const res = await api.handle(method, `/api/${path}`, q, body, user)
    if (res.status >= 400) {
      throw new Error(((res.json as Record<string, unknown>)?.error as string) ?? `API error ${res.status}`)
    }
    return res.json
  }

  // ── md4lp_auth_status ─────────────────────────────────────────────────────────
  server.tool(
    'md4lp_auth_status',
    'Get current authentication status, active agent session info, and authorized project scopes.',
    {},
    async () => {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ok: true,
                agentUser: defaultAgentUser,
                status: 'active',
                server: 'md4lp',
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── md4lp_list_projects ───────────────────────────────────────────────────────
  server.tool(
    'md4lp_list_projects',
    'List all projects the agent is authorized to interact with.',
    {},
    async () => {
      const allProjects = await api.projects.listAllProjects()
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              allProjects.map((p) => ({
                id: p.id,
                name: p.name,
                slug: p.slug,
                description: p.description,
              })),
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── list_files / md4lp_list_files ─────────────────────────────────────────────
  const listFilesHandler = async ({ projectId }: { projectId?: string }) => {
    if (projectId) {
      const repo = await api.projects.getProjectRepo(projectId)
      const files = await repo.listFiles('main')
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ projectId, branch: 'main', files: files.filter((f: string) => f.endsWith('.md')) }),
          },
        ],
      }
    }
    const state = (await call('GET', 'state')) as { files: string[]; branch: string }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ branch: state.branch, files: state.files }) }],
    }
  }

  server.tool('list_files', 'List all Markdown files in the workspace.', { projectId: projectIdField }, listFilesHandler)
  server.tool('md4lp_list_files', 'List Markdown files in a project.', { projectId: projectIdField }, listFilesHandler)

  // ── read_file / md4lp_read_file ───────────────────────────────────────────────
  const readFileHandler = async ({ path, projectId }: { path: string; projectId?: string }) => {
    if (projectId) {
      const repo = await api.projects.getProjectRepo(projectId)
      const content = await repo.readFile('main', path)
      return { content: [{ type: 'text' as const, text: content }] }
    }
    const result = (await call('GET', 'file', { path })) as { content: string }
    return { content: [{ type: 'text' as const, text: result.content }] }
  }

  server.tool('read_file', 'Read Markdown file content.', { path: pathField, projectId: projectIdField }, readFileHandler)
  server.tool('md4lp_read_file', 'Read Markdown file content from project.', { path: pathField, projectId: projectIdField }, readFileHandler)

  // ── write_file / md4lp_write_file ─────────────────────────────────────────────
  const writeFileHandler = async ({
    path,
    content,
    message,
    projectId,
  }: {
    path: string
    content: string
    message?: string
    projectId?: string
  }) => {
    if (projectId) {
      const repo = await api.projects.getProjectRepo(projectId)
      const author = { name: defaultAgentUser, email: `${defaultAgentUser}@agent.md4lp.local` }
      const oid = await repo.writeFiles(
        'main',
        [{ path, content }],
        message ?? `agent (${defaultAgentUser}): edit ${path}`,
        author,
      )
      return { content: [{ type: 'text' as const, text: `committed ${String(oid).slice(0, 7)} to project ${projectId}` }] }
    }
    await call('POST', 'lock/acquire', { path })
    let oid: string
    try {
      oid = ((await call(
        'PUT',
        'file',
        { path },
        { content, message: message ?? `agent: edit ${path}` },
      )) as { oid: string }).oid
    } finally {
      await call('POST', 'lock/release', { path })
    }
    return { content: [{ type: 'text' as const, text: `committed ${String(oid).slice(0, 7)}` }] }
  }

  server.tool(
    'write_file',
    'Write a Markdown file.',
    { path: pathField, ...putFileFields, projectId: projectIdField },
    writeFileHandler,
  )
  server.tool(
    'md4lp_write_file',
    'Write a Markdown file in a project.',
    { path: pathField, ...putFileFields, projectId: projectIdField },
    writeFileHandler,
  )

  // ── list_comments / md4lp_list_comments ───────────────────────────────────────
  const listCommentsHandler = async ({ path }: { path: string; projectId?: string }) => {
    const result = (await call('GET', 'comments', { path })) as { comments: unknown[] }
    return { content: [{ type: 'text' as const, text: JSON.stringify(result.comments, null, 2) }] }
  }

  server.tool('list_comments', 'List open comments on a file.', { path: pathField, projectId: projectIdField }, listCommentsHandler)
  server.tool('md4lp_list_comments', 'List open comments on a file in project.', { path: pathField, projectId: projectIdField }, listCommentsHandler)

  // ── add_comment / md4lp_add_comment ───────────────────────────────────────────
  const addCommentHandler = async ({
    path,
    start,
    end,
    body,
    suggestion,
  }: {
    path: string
    start?: number
    end?: number
    body: string
    suggestion?: string
    projectId?: string
  }) => {
    const result = (await call('POST', 'comment', { path }, { start, end, body, suggestion })) as {
      comment: { id: string }
    }
    return { content: [{ type: 'text' as const, text: `comment ${result.comment.id}` }] }
  }

  server.tool('add_comment', 'Add an anchored comment or suggestion.', { path: pathField, ...commentFields, projectId: projectIdField }, addCommentHandler)
  server.tool('md4lp_add_comment', 'Add an anchored comment in project.', { path: pathField, ...commentFields, projectId: projectIdField }, addCommentHandler)

  // ── resolve_comment / md4lp_resolve_comment ───────────────────────────────────
  const resolveCommentHandler = async ({
    commentId,
    owner,
    path,
  }: {
    commentId: string
    owner: string
    path: string
    projectId?: string
  }) => {
    await call('POST', 'suggestion/reject', { path }, { commentId, owner })
    return { content: [{ type: 'text' as const, text: `resolved ${commentId}` }] }
  }

  server.tool('resolve_comment', 'Mark a comment as resolved.', { ...suggestionRefFields, path: pathField, projectId: projectIdField }, resolveCommentHandler)
  server.tool('md4lp_resolve_comment', 'Mark comment as resolved in project.', { ...suggestionRefFields, path: pathField, projectId: projectIdField }, resolveCommentHandler)

  return server
}

export async function mountMcp(app: Hono, api: Api, agentUser = DEFAULT_AGENT_USER): Promise<void> {
  const server = createMcpServer(api, agentUser)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  })
  await server.connect(transport)

  app.all('/mcp', (c) => transport.handleRequest(c.req.raw))
}

