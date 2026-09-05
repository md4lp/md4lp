import { describe, it, expect } from 'vitest'
import { merge3 } from '../src/diff3'

describe('merge3', () => {
  it('clean merge when only ours changed', () => {
    const base = 'line 1\nline 2\nline 3'
    const ours = 'line 1\nline 2 edited\nline 3'
    const theirs = 'line 1\nline 2\nline 3'

    const res = merge3(base, ours, theirs)
    expect(res.conflict).toBe(false)
    expect(res.resolvedText).toBe(ours)
  })

  it('clean merge when only theirs changed', () => {
    const base = 'line 1\nline 2\nline 3'
    const ours = 'line 1\nline 2\nline 3'
    const theirs = 'line 1\nline 2\nline 3 edited'

    const res = merge3(base, ours, theirs)
    expect(res.conflict).toBe(false)
    expect(res.resolvedText).toBe(theirs)
  })

  it('clean merge when both changed non-overlapping lines', () => {
    const base = 'line 1\nline 2\nline 3'
    const ours = 'line 1 edited\nline 2\nline 3'
    const theirs = 'line 1\nline 2\nline 3 edited'

    const res = merge3(base, ours, theirs)
    expect(res.conflict).toBe(false)
    expect(res.resolvedText).toBe('line 1 edited\nline 2\nline 3 edited')
  })

  it('detects conflict on overlapping line edits', () => {
    const base = 'line 1\nline 2\nline 3'
    const ours = 'line 1\nline 2 ours\nline 3'
    const theirs = 'line 1\nline 2 theirs\nline 3'

    const res = merge3(base, ours, theirs)
    expect(res.conflict).toBe(true)
    expect(res.chunks.some((c) => c.type === 'conflict')).toBe(true)
  })
})
