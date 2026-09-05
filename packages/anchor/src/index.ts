import { diff_match_patch } from 'diff-match-patch'

/**
 * @md4lp/anchor — durable text anchoring for comments/notes on Markdown.
 *
 * An anchor is created against a specific version of a text (e.g. the canonical `.md` at one commit)
 * and records the span's character range `[start, end)`, the exact spanned text (`quote`), and a
 * short slice of surrounding context (`prefix`/`suffix`). It can then be re-located against an edited
 * version of the text:
 *   - `intact`   the span is still exactly where it was;
 *   - `moved`    the span survived elsewhere (new offsets returned);
 *   - `orphaned` the span can no longer be located with confidence (caller re-points or drops it).
 *
 * Cross-version re-anchoring maps the original offset THROUGH the actual edit (diff), so it lands on
 * the correct occurrence and never jumps to an unrelated re-use of the same word. Dependency-light
 * (only diff-match-patch) and DOM-free, so it is reusable as a standalone library.
 */

export interface TextAnchor {
  /** Start offset of the span in the text the anchor was created against. */
  start: number
  /** End offset (exclusive). */
  end: number
  /** Exact text between start and end. Identifies the note and drives semantic re-anchoring. */
  quote: string
  /** Up to `context` chars immediately before `start`. Disambiguates repeated quotes. */
  prefix: string
  /** Up to `context` chars immediately after `end`. */
  suffix: string
}

export type AnchorStatus = 'intact' | 'moved' | 'orphaned'

export interface AnchorResolution {
  status: AnchorStatus
  /** Present when status is `intact` or `moved`. */
  start?: number
  /** Present when status is `intact` or `moved`. */
  end?: number
}

/** Default context characters captured on each side. */
export const DEFAULT_CONTEXT = 32

/** Minimum matching context chars to accept a context-only (non-diff) relocation as `moved`. */
const MIN_CONTEXT_FOR_MOVE = 4

/** Create an anchor for the span `[start, end)` within `text`. */
export function createAnchor(text: string, start: number, end: number, context = DEFAULT_CONTEXT): TextAnchor {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || start >= end) {
    throw new RangeError(`createAnchor: invalid range [${start}, ${end}) for text of length ${text.length}`)
  }
  return {
    start,
    end,
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - context), start),
    suffix: text.slice(end, Math.min(text.length, end + context)),
  }
}

/**
 * Resolve an anchor against a SAME-version (or unknown-provenance) text. Prefers the exact recorded
 * offsets (intact); otherwise searches occurrences and relocates only if surrounding context matches.
 * For cross-version edits, prefer {@link reanchor}, which is precise.
 */
export function resolveAnchor(text: string, anchor: TextAnchor): AnchorResolution {
  if (text.slice(anchor.start, anchor.end) === anchor.quote) {
    return { status: 'intact', start: anchor.start, end: anchor.end }
  }
  const occurrences = indexesOf(text, anchor.quote)
  if (occurrences.length === 0) return { status: 'orphaned' }

  let best = -1
  let bestContext = -1
  let bestDistance = Infinity
  for (const i of occurrences) {
    const actualPrefix = text.slice(Math.max(0, i - anchor.prefix.length), i)
    const actualSuffix = text.slice(i + anchor.quote.length, i + anchor.quote.length + anchor.suffix.length)
    const ctx = commonSuffixLength(actualPrefix, anchor.prefix) + commonPrefixLength(actualSuffix, anchor.suffix)
    const distance = Math.abs(i - anchor.start)
    if (ctx > bestContext || (ctx === bestContext && distance < bestDistance)) {
      best = i
      bestContext = ctx
      bestDistance = distance
    }
  }
  // Require real surrounding context (not just the bounding whitespace) before relocating, so a note
  // is orphaned rather than silently re-anchored to an unrelated reuse of the same word.
  if (best >= 0 && bestContext >= MIN_CONTEXT_FOR_MOVE) {
    return { status: 'moved', start: best, end: best + anchor.quote.length }
  }
  return { status: 'orphaned' }
}

/**
 * Re-anchor across versions. Maps the original offsets through the diff `oldText -> newText`, so the
 * span is followed precisely (the correct occurrence, even with duplicates) or detected as deleted.
 * Falls back to context search only when the span text itself changed.
 */
export function reanchor(oldText: string, newText: string, anchor: TextAnchor): AnchorResolution {
  if (oldText === newText) return resolveAnchor(newText, anchor)

  const dmp = new diff_match_patch()
  const diffs = dmp.diff_main(oldText, newText)
  dmp.diff_cleanupSemantic(diffs)
  const newStart = dmp.diff_xIndex(diffs, anchor.start)
  const newEnd = dmp.diff_xIndex(diffs, anchor.end)

  if (newEnd > newStart && newText.slice(newStart, newEnd) === anchor.quote) {
    const intact = newStart === anchor.start && newEnd === anchor.end
    return { status: intact ? 'intact' : 'moved', start: newStart, end: newEnd }
  }
  // Span no longer maps to the exact quote (edited or removed). Try a context-guarded relocation.
  return resolveAnchor(newText, anchor)
}

function indexesOf(haystack: string, needle: string): number[] {
  const out: number[] = []
  if (needle.length === 0) return out
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) out.push(i)
  return out
}

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return i
}

function commonSuffixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}

export * from './diff3'
