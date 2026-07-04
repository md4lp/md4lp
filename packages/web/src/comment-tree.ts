import type { Reply, Sidecar } from './types'

/**
 * Find a node's current body by id within a reply tree. Used to detect whether the message being
 * replied to changed while the reply composer was open. Pure (no DOM, no state).
 */
export function findReplyBody(replies: Reply[], id: string): string | null {
  for (const r of replies) {
    if (r.id === id) return r.body
    const n = findReplyBody(r.replies, id)
    if (n !== null) return n
  }
  return null
}

/** Find a node's body by id across all threads (the comment itself or any nested reply). */
export function findNodeBody(comments: Sidecar[], id: string): string | null {
  for (const c of comments) {
    if (c.comment.id === id) return c.comment.body
    const r = findReplyBody(c.comment.replies, id)
    if (r !== null) return r
  }
  return null
}
