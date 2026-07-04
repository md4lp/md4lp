import YAML from 'yaml'
import { AsyncQueue } from '@md4lp/async-queue'
import type { TextAnchor } from '@md4lp/anchor'
import type { RepoBackend, Author } from '@md4lp/repo'

/**
 * @md4lp/comments — comment threads as per-CREATOR YAML sidecars stored in the repo (D3/D17).
 *
 * A whole thread (comment + nested replies) lives in the creator's branch sidecar
 * `.md4lp/<filePath>.<creator>.comments.yaml`. The SERVER is the sole writer (users never push these
 * files), so concurrent writes are serialized, not human merge conflicts. Replies form a tree, so a
 * comment can host several conversation lines. Anchors (D16) are stored against the `.md` at the
 * comment's `commit`; resolving an anchor against any branch's current `.md` is done by the caller via
 * @md4lp/anchor (this package is storage-only).
 */

export interface Reply {
  id: string
  author: string
  createdAt: string
  updatedAt?: string
  body: string
  /** emoji → list of user ids who reacted. */
  reactions?: Record<string, string[]>
  /** Nested replies (a reply can be replied to → multiple conversation lines). */
  replies: Reply[]
}

/** Result of an edit attempt (optimistic concurrency: a node is only editable while it has no replies). */
export type EditResult = 'ok' | 'forbidden' | 'conflict' | 'notfound'

export interface Comment {
  id: string
  author: string
  createdAt: string
  updatedAt?: string
  /** Ref/SHA whose `.md` the anchor offsets were created against. */
  commit: string
  filePath: string
  anchor: TextAnchor
  body: string
  status: 'open' | 'resolved'
  reactions?: Record<string, string[]>
  replies: Reply[]
  /** Optional proposed replacement for the anchored span (a suggestion). */
  suggestion?: string
}

export interface AddCommentInput {
  anchor: TextAnchor
  commit: string
  body: string
  suggestion?: string
}

export interface CommentStoreOptions {
  id?: () => string
  now?: () => string
}

const SIDECAR_VERSION = 2

export class CommentStore {
  private readonly repo: RepoBackend
  private readonly id: () => string
  private readonly now: () => string

  // Serialize all mutations. Each mutating method is a read-modify-write (list → mutate → write);
  // the repo's own mutex makes each git op atomic, but NOT the read+write pair, so two concurrent
  // mutations of the same sidecar could both read the old state and the second would clobber the
  // first (lost update). A single-lane queue makes each full RMW sequence atomic within this process.
  private readonly lock = new AsyncQueue()

  constructor(repo: RepoBackend, opts: CommentStoreOptions = {}) {
    this.repo = repo
    this.id = opts.id ?? (() => crypto.randomUUID())
    this.now = opts.now ?? (() => new Date().toISOString())
  }

  sidecarPath(filePath: string, creator: string): string {
    return `.md4lp/${filePath}.${creator}.comments.yaml`
  }

  /** List a creator's comment threads for a file, read from `branch` (the creator's branch). */
  async list(branch: string, filePath: string, creator: string): Promise<Comment[]> {
    let raw: string
    try {
      raw = await this.repo.readFile(branch, this.sidecarPath(filePath, creator))
    } catch {
      return []
    }
    const doc = YAML.parse(raw) as { version?: number; comments?: Comment[] } | null
    // Guard the persisted schema: refuse a sidecar written by a newer/unknown format rather than
    // casting unknown shapes to Comment[]. This gives `version` a purpose and a future migration seam.
    if (doc?.version !== undefined && doc.version !== SIDECAR_VERSION) {
      throw new Error(`unsupported comment sidecar version ${doc.version} (expected ${SIDECAR_VERSION})`)
    }
    return doc?.comments ?? []
  }

  /** Add a comment (or suggestion) to the creator's sidecar on `branch`. */
  add(branch: string, filePath: string, creator: string, author: Author, input: AddCommentInput): Promise<Comment> {
    return this.lock.run(async () => {
      const comments = await this.list(branch, filePath, creator)
      const comment: Comment = {
        id: this.id(),
        author: author.name,
        createdAt: this.now(),
        commit: input.commit,
        filePath,
        anchor: input.anchor,
        body: input.body,
        status: 'open',
        replies: [],
        ...(input.suggestion !== undefined ? { suggestion: input.suggestion } : {}),
      }
      comments.push(comment)
      await this.write(branch, filePath, creator, author, comments, `comment: add ${comment.id}`)
      return comment
    })
  }

  /** Append a reply to a node (a comment or any nested reply) identified by `parentId`. */
  addReply(branch: string, filePath: string, creator: string, parentId: string, replier: Author, body: string): Promise<Reply> {
    return this.lock.run(async () => {
      const comments = await this.list(branch, filePath, creator)
      const node = findNode(comments, parentId)
      if (!node) throw new Error(`reply target not found: ${parentId}`)
      const reply: Reply = { id: this.id(), author: replier.name, createdAt: this.now(), body, replies: [] }
      node.replies.push(reply)
      await this.write(branch, filePath, creator, replier, comments, `comment: reply ${reply.id}`)
      return reply
    })
  }

  setStatus(branch: string, filePath: string, creator: string, author: Author, commentId: string, status: Comment['status']): Promise<void> {
    return this.lock.run(async () => {
      const comments = await this.list(branch, filePath, creator)
      const comment = comments.find((c) => c.id === commentId)
      if (!comment) throw new Error(`comment not found: ${commentId}`)
      comment.status = status
      await this.write(branch, filePath, creator, author, comments, `comment: ${status} ${commentId}`)
    })
  }

  /**
   * Edit a node's body. Only the node's author may edit, and only while it has NO replies. The
   * no-replies check is re-evaluated here at save time, so a reply that landed since the editor opened
   * yields a `conflict` instead of silently overwriting.
   */
  editBody(branch: string, filePath: string, creator: string, nodeId: string, author: Author, body: string): Promise<EditResult> {
    return this.lock.run(async () => {
      const comments = await this.list(branch, filePath, creator)
      const node = findNode(comments, nodeId)
      if (!node) return 'notfound'
      if (node.author !== author.name) return 'forbidden'
      if (node.replies.length > 0) return 'conflict'
      node.body = body
      node.updatedAt = this.now()
      await this.write(branch, filePath, creator, author, comments, `comment: edit ${nodeId}`)
      return 'ok'
    })
  }

  /** Toggle a reactor's emoji reaction on a node (comment or reply). */
  toggleReaction(branch: string, filePath: string, creator: string, nodeId: string, reactor: Author, emoji: string): Promise<void> {
    return this.lock.run(async () => {
      const comments = await this.list(branch, filePath, creator)
      const node = findNode(comments, nodeId)
      if (!node) throw new Error(`reaction target not found: ${nodeId}`)
      const reactions = node.reactions ?? {}
      const users = reactions[emoji] ?? []
      const i = users.indexOf(reactor.name)
      if (i >= 0) users.splice(i, 1)
      else users.push(reactor.name)
      if (users.length > 0) reactions[emoji] = users
      else delete reactions[emoji]
      node.reactions = reactions
      await this.write(branch, filePath, creator, reactor, comments, `comment: react ${emoji} ${nodeId}`)
    })
  }

  private async write(branch: string, filePath: string, creator: string, author: Author, comments: Comment[], message: string): Promise<void> {
    const content = YAML.stringify({ version: SIDECAR_VERSION, comments })
    await this.repo.writeFiles(branch, [{ path: this.sidecarPath(filePath, creator), content }], message, author)
  }
}

/** Find a comment or any nested reply by id; returns the node holding the `replies` array. */
function findNode(comments: Comment[], id: string): Comment | Reply | null {
  for (const c of comments) {
    if (c.id === id) return c
    const inReplies = findInReplies(c.replies, id)
    if (inReplies) return inReplies
  }
  return null
}

function findInReplies(replies: Reply[], id: string): Reply | null {
  for (const r of replies) {
    if (r.id === id) return r
    const nested = findInReplies(r.replies, id)
    if (nested) return nested
  }
  return null
}
