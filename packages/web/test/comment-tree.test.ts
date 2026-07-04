import { describe, it, expect } from 'vitest'
import { findNodeBody, findReplyBody } from '../src/comment-tree'
import type { Reply, Sidecar } from '../src/types'

const reply = (id: string, body: string, replies: Reply[] = []): Reply => ({ id, author: 'u', createdAt: '', body, replies })

const sidecar = (id: string, body: string, replies: Reply[] = []): Sidecar => ({
  owner: 'alice',
  comment: { id, author: 'alice', body, status: 'open', replies, anchor: { quote: '', start: 0, end: 0 } },
  resolution: { status: 'intact' },
})

describe('comment-tree', () => {
  it('finds a top-level comment body by id', () => {
    const comments = [sidecar('c1', 'hello'), sidecar('c2', 'world')]
    expect(findNodeBody(comments, 'c2')).toBe('world')
  })

  it('finds a nested reply body at any depth', () => {
    const deep = reply('r1', 'first', [reply('r2', 'nested', [reply('r3', 'deepest')])])
    const comments = [sidecar('c1', 'top', [deep])]
    expect(findNodeBody(comments, 'r3')).toBe('deepest')
    expect(findReplyBody([deep], 'r2')).toBe('nested')
  })

  it('returns null when the id is absent', () => {
    expect(findNodeBody([sidecar('c1', 'x')], 'missing')).toBeNull()
    expect(findReplyBody([], 'missing')).toBeNull()
  })
})
