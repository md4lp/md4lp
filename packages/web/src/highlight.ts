/**
 * Locating comment anchors in the rendered Review DOM. Pure functions (take the root element), so the
 * tricky offset/text-walking logic is unit-testable without the full app.
 */

// Flatten the rendered text of `root` into one string + the text nodes that compose it, so a character
// offset in the flat string can be mapped back to a (node, offset) DOM point.
function flattenText(root: HTMLElement): { nodes: Text[]; full: string } {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let full = ''
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text)
    full += (n as Text).data
  }
  return { nodes, full }
}

function pointAt(nodes: Text[], off: number): [Text, number] {
  let acc = 0
  for (const n of nodes) {
    if (off <= acc + n.data.length) return [n, off - acc]
    acc += n.data.length
  }
  const last = nodes[nodes.length - 1]!
  return [last, last.data.length]
}

function rangeFromOffsets(root: HTMLElement, nodes: Text[], start: number, end: number): Range {
  const [sN, sO] = pointAt(nodes, start)
  const [eN, eO] = pointAt(nodes, end)
  const r = root.ownerDocument.createRange()
  r.setStart(sN, sO)
  r.setEnd(eN, eO)
  return r
}

/** Find a DOM Range matching `quote` within the rendered text of `root` (exact rendered-text match). */
export function findTextRange(root: HTMLElement, quote: string): Range | null {
  if (!quote) return null
  const { nodes, full } = flattenText(root)
  const i = full.indexOf(quote)
  if (i < 0) return null
  return rangeFromOffsets(root, nodes, i, i + quote.length)
}

/** Find every Range matching `query` (case-insensitive) in the rendered text — for in-doc search. */
export function findAllRanges(root: HTMLElement, query: string): Range[] {
  if (!query) return []
  const { nodes, full } = flattenText(root)
  const hay = full.toLowerCase()
  const needle = query.toLowerCase()
  const ranges: Range[] = []
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
    ranges.push(rangeFromOffsets(root, nodes, i, i + needle.length))
  }
  return ranges
}

/**
 * Find a Range over the innermost block element whose source span [data-s, data-e) contains `offset`.
 * Used as the fallback when the exact rendered text can't be located.
 */
export function findBlockRange(root: HTMLElement, offset: number): Range | null {
  let best: HTMLElement | null = null
  let bestSpan = Infinity
  for (const el of root.querySelectorAll<HTMLElement>('[data-s][data-e]')) {
    const s = Number(el.getAttribute('data-s'))
    const e = Number(el.getAttribute('data-e'))
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue
    if (s <= offset && offset < e && e - s < bestSpan) {
      best = el
      bestSpan = e - s
    }
  }
  if (!best) return null
  const r = root.ownerDocument.createRange()
  r.selectNodeContents(best)
  return r
}

/**
 * Locate the Range to highlight for a comment anchor:
 *   1. exact rendered-text match of the source quote (fine-grained; plain-text selections);
 *   2. fallback (R2): when the quote carries Markdown markers that aren't in the rendered text (the
 *      selection crossed inline formatting), highlight the block covering the source `offset` —
 *      consistent with comments anchoring to the block, not inside the rendered widget.
 */
export function locateRange(root: HTMLElement, quote: string, offset?: number): Range | null {
  const exact = findTextRange(root, quote)
  if (exact) return exact
  if (offset !== undefined) return findBlockRange(root, offset)
  return null
}
