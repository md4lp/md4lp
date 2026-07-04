import { describe, it, expect } from 'vitest'
import { createAnchor, resolveAnchor, reanchor } from '../src/index'

// Helper: anchor the Nth (0-based) occurrence of `word` in `text`.
function anchorOccurrence(text: string, word: string, n = 0) {
  let idx = -1
  for (let k = 0; k <= n; k++) idx = text.indexOf(word, idx + 1)
  return createAnchor(text, idx, idx + word.length)
}

describe('createAnchor', () => {
  it('captures span, quote and context', () => {
    const text = 'The brown fox jumps over.'
    const a = anchorOccurrence(text, 'fox')
    expect(a.quote).toBe('fox')
    expect(text.slice(a.start, a.end)).toBe('fox')
    expect(a.prefix.endsWith('brown ')).toBe(true)
    expect(a.suffix.startsWith(' jumps')).toBe(true)
  })

  it('rejects an invalid range', () => {
    expect(() => createAnchor('abc', 2, 1)).toThrow(RangeError)
    expect(() => createAnchor('abc', 0, 99)).toThrow(RangeError)
  })
})

describe('resolveAnchor (same version)', () => {
  it('bug (c): a duplicate word resolves to the chosen occurrence, not the first', () => {
    const text = 'fox here and fox there'
    const a = anchorOccurrence(text, 'fox', 1) // the SECOND fox
    const r = resolveAnchor(text, a)
    expect(r.status).toBe('intact')
    expect(r.start).toBe(text.indexOf('fox', 1)) // second occurrence, not index 0
  })
})

describe('reanchor (across versions)', () => {
  it('intact when nothing changed', () => {
    const text = 'The brown fox jumps over.'
    const a = anchorOccurrence(text, 'fox')
    expect(reanchor(text, text, a)).toMatchObject({ status: 'intact' })
  })

  it('moved when text is inserted before the span (offsets shift, quote intact)', () => {
    const oldText = 'The brown fox jumps over.'
    const newText = 'Note: The brown fox jumps over.'
    const a = anchorOccurrence(oldText, 'fox')
    const r = reanchor(oldText, newText, a)
    expect(r.status).toBe('moved')
    expect(newText.slice(r.start!, r.end!)).toBe('fox')
    expect(r.start).toBe(newText.indexOf('fox'))
  })

  it('orphaned when the span is deleted/replaced', () => {
    const oldText = 'The brown fox jumps over.'
    const newText = 'The brown dog jumps over.'
    const a = anchorOccurrence(oldText, 'fox')
    expect(reanchor(oldText, newText, a)).toMatchObject({ status: 'orphaned' })
  })

  it('bug (b): deleted here and rewritten elsewhere => orphaned, not jumped to the new one', () => {
    const oldText = 'The brown fox jumps over the fence.'
    const newText = 'The brown cat sleeps all day. Later, a fox appears.'
    const a = anchorOccurrence(oldText, 'fox') // original fox (context: "The brown " / " jumps ")
    const r = reanchor(oldText, newText, a)
    expect(r.status).toBe('orphaned')
  })

  it('bug (c) across versions: duplicate maps to the right occurrence via the diff', () => {
    const oldText = 'fox here and fox there'
    const newText = 'XX fox here and fox there' // everything shifts by 3
    const a = anchorOccurrence(oldText, 'fox', 1) // the SECOND fox
    const r = reanchor(oldText, newText, a)
    expect(r.status).toBe('moved')
    // must land on the SECOND fox in newText, not the first
    expect(r.start).toBe(newText.indexOf('fox', newText.indexOf('fox') + 1))
  })
})
