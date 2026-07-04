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
