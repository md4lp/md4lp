// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderToHtml } from '@md4lp/render'
import { findTextRange, findBlockRange, locateRange, findAllRanges } from '../src/highlight'

function review(md: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = renderToHtml(md)
  document.body.appendChild(root)
  return root
}

describe('highlight', () => {
  it('findTextRange matches plain rendered text', () => {
    const root = review('The brown fox jumps.\n')
    const r = findTextRange(root, 'fox')
    expect(r?.toString()).toBe('fox')
  })

  it('findTextRange returns null for absent or empty text', () => {
    const root = review('Hello world.\n')
    expect(findTextRange(root, 'nonexistent')).toBeNull()
    expect(findTextRange(root, '')).toBeNull()
  })

  it('findBlockRange returns the innermost block covering a source offset', () => {
    const root = review('# Title\n\nA paragraph here.\n')
    // offset 12 falls inside the paragraph (which starts after "# Title\n\n")
    const r = findBlockRange(root, 12)
    expect(r).not.toBeNull()
    expect(r!.toString()).toContain('paragraph')
  })

  it('locateRange falls back to the block when the quote has inline markers (R2)', () => {
    const md = 'A **bold** word.\n'
    const root = review(md)
    // the source quote for a selection crossing the bold span includes ** — not present in the DOM text
    const quoteWithMarkers = 'A **bold** word.'
    const offset = md.indexOf('bold')
    // exact text match fails…
    expect(findTextRange(root, quoteWithMarkers)).toBeNull()
    // …but locateRange recovers via the block offset
    const r = locateRange(root, quoteWithMarkers, offset)
    expect(r).not.toBeNull()
    expect(r!.toString()).toContain('bold')
  })

  it('locateRange prefers the exact text match when available', () => {
    const root = review('The brown fox jumps.\n')
    const r = locateRange(root, 'fox', 4)
    expect(r?.toString()).toBe('fox') // fine-grained, not the whole block
  })

  it('findAllRanges finds every case-insensitive match', () => {
    const root = review('The cat sat. The CAT ran. A cathedral too.\n')
    const ranges = findAllRanges(root, 'cat')
    expect(ranges.length).toBe(3) // "cat", "CAT", and "cat" inside cathedral
    expect(ranges.every((r) => r.toString().toLowerCase() === 'cat')).toBe(true)
    expect(findAllRanges(root, '')).toEqual([])
    expect(findAllRanges(root, 'zzz')).toEqual([])
  })
})
