/**
 * Shapes the web client receives from the server.
 *
 * These mirror `@md4lp/comments` / `@md4lp/server`, but the web app is a pure proxy CLIENT and must
 * not import server packages (they pull in isomorphic-git, the canonicalizer, etc.). So the shapes
 * are re-declared here, kept minimal: only the fields the UI actually reads.
 */

export interface Reply {
  id: string
  author: string
  createdAt: string
  body: string
  reactions?: Record<string, string[]>
  replies: Reply[]
}

/** A comment thread as aggregated+re-anchored by the server for the current viewer. */
export interface Sidecar {
  owner: string
  comment: {
    id: string
    author: string
    body: string
    status: string
    suggestion?: string
    reactions?: Record<string, string[]>
    replies: Reply[]
    anchor: { quote: string; start: number; end: number }
  }
  resolution: { status: 'intact' | 'moved' | 'orphaned'; start?: number; end?: number }
}

/** Response of `GET /api/state`. */
export interface State {
  user: string
  role: 'editor' | 'commenter'
  users: Array<{ id: string; role: string }>
  branch: string
  files: string[]
}

/** Response of `GET /api/file`. `lock.editor` is who is editing this file live (null if nobody). */
export interface FileResponse {
  path: string
  branch: string
  content: string
  lock: { editor: string | null }
}

/** A live event pushed over SSE (`GET /api/events`). Mirrors `@md4lp/server`'s `Md4lpEvent`. */
export interface LiveEvent {
  type: 'doc' | 'comments' | 'lock'
  file: string
  by: string
  editor?: string | null
}
