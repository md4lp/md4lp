import { z } from 'zod'

/**
 * Request-body schemas — the SINGLE source of truth for the shape of every mutating request.
 *
 * Each route's fields are declared once as a raw zod shape (`*Fields`) so they can be reused two
 * ways without drift:
 *   - the REST layer (`api.ts`) parses the whole body via the `z.object(...)` form → 400 on bad input;
 *   - the MCP layer (`mcp.ts`) spreads the same fields into a tool's input shape (plus `path`, which
 *     REST carries in the query string).
 */

// Descriptions on shared fields double as MCP tool-parameter docs for the agent.
export const putFileFields = {
  content: z.string().describe('Full Markdown content to write'),
  message: z.string().optional().describe('Commit message (optional)'),
}

export const commentFields = {
  start: z.number().int().describe('Start offset in the .md source (character index)'),
  end: z.number().int().describe('End offset in the .md source'),
  body: z.string().describe('Comment body (Markdown)'),
  suggestion: z.string().optional().describe('Proposed replacement text for the selected range'),
}

export const replyFields = {
  parentId: z.string(),
  owner: z.string(),
  body: z.string(),
}

export const editFields = {
  nodeId: z.string(),
  owner: z.string(),
  body: z.string(),
}

export const reactFields = {
  nodeId: z.string(),
  owner: z.string(),
  emoji: z.string(),
}

/** Identifies a suggestion (and its creator branch) for apply/reject. */
export const suggestionRefFields = {
  commentId: z.string().describe('Comment id'),
  owner: z.string().describe('Username who created the comment'),
}

/** Edit-lock requests (acquire/heartbeat/release) — the file is carried in the query string (D20). */
export const lockFields = {}

export const putFileBody = z.object(putFileFields)
export const commentBody = z.object(commentFields)
export const replyBody = z.object(replyFields)
export const editBody = z.object(editFields)
export const reactBody = z.object(reactFields)
export const suggestionRefBody = z.object(suggestionRefFields)

export const lookupIdentifierBody = z.object({
  identifier: z.string().min(1),
})

export const checkUsernameBody = z.object({
  username: z.string().min(1),
})

export const requestCodeBody = z.object({
  identifier: z.string().min(1).optional(),
  email: z.string().optional(),
  purpose: z.string().min(1).default('login'),
  name: z.string().optional(),
  username: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).transform((data) => ({
  identifier: data.identifier || data.email || '',
  purpose: data.purpose,
  name: data.name,
  username: data.username,
  metadata: data.metadata,
})).refine((data) => data.identifier.length > 0, {
  message: 'Email or username is required',
})

export const verifyCodeBody = z.object({
  identifier: z.string().min(1).optional(),
  email: z.string().optional(),
  purpose: z.string().min(1).default('login'),
  code: z.string().min(1),
  name: z.string().optional(),
  username: z.string().optional(),
}).transform((data) => ({
  identifier: data.identifier || data.email || '',
  purpose: data.purpose,
  code: data.code,
  name: data.name,
  username: data.username,
})).refine((data) => data.identifier.length > 0, {
  message: 'Email or username is required',
})

export const emailOnlyBody = z.object({
  email: z.string().email(),
})

export const verifyAddEmailBody = z.object({
  email: z.string().email(),
  code: z.string().min(1),
})

export const updateProfileBody = z.object({
  name: z.string().optional(),
  username: z.string().optional(),
  avatarUrl: z.string().optional(),
})

export const createTeamBody = z.object({
  name: z.string().min(1),
})

export const joinDomainTeamBody = z.object({
  teamId: z.string(),
  contextEmail: z.string().email(),
})

export const inviteTeamMemberBody = z.object({
  target: z.string().min(1),
  role: z.enum(['admin', 'member']).optional(),
})

export const acceptTeamInvitationBody = z.object({
  contextEmail: z.string().email().optional(),
})

export const expelDomainMemberBody = z.object({
  targetUserId: z.string(),
  reverificationCode: z.string().min(1),
})

export const removeTeamMemberBody = z.object({
  targetUserId: z.string().min(1),
  reverificationCode: z.string().min(1),
})

export const createProjectBody = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().optional(),
  contextEmail: z.string().email().optional(),
  initialReadme: z.string().optional(),
})

export const inviteProjectMemberBody = z.object({
  target: z.string().min(1),
  role: z.enum(['owner', 'editor', 'commenter', 'viewer']).optional(),
})

export const acceptProjectInvitationBody = z.object({
  contextEmail: z.string().email().optional(),
})

export const assignProjectTeamBody = z.object({
  teamId: z.string().min(1),
  role: z.enum(['owner', 'editor', 'commenter', 'viewer']).optional(),
})

export const removeProjectMemberBody = z.object({
  targetUserId: z.string().min(1),
  reverificationCode: z.string().min(1),
})

export const updateProjectContextEmailBody = z.object({
  contextEmail: z.string().email(),
})

export const createAgentGrantBody = z.object({
  agentName: z.string().min(1, 'Agent name is required'),
  description: z.string().optional(),
  codeChallenge: z.string().min(1, 'PKCE code challenge is required'),
  projectScopes: z.array(
    z.object({
      projectId: z.string().min(1),
      maxRole: z.enum(['editor', 'commenter', 'viewer']),
    }),
  ),
})

export const exchangeAgentTokenBody = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  codeVerifier: z.string().optional(),
  code_verifier: z.string().optional(),
}).transform((data) => ({
  code: data.code,
  codeVerifier: data.codeVerifier || data.code_verifier || '',
})).refine((data) => data.codeVerifier.length > 0, {
  message: 'PKCE code verifier is required',
})



