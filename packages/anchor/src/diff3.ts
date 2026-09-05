import { diff_match_patch } from 'diff-match-patch'

export interface Diff3Chunk {
  type: 'clean' | 'conflict'
  ours: string
  theirs: string
  base?: string
  merged?: string
}

export interface Diff3Result {
  conflict: boolean
  chunks: Diff3Chunk[]
  resolvedText?: string
}

/**
 * Line-based 3-way merge engine (base vs ours vs theirs) without AST loss.
 * If there are no conflicting overlapping edits, returns resolvedText and conflict=false.
 * If conflicts exist, conflict=true and chunks contain the separated segments.
 */
export function merge3(baseText: string, oursText: string, theirsText: string): Diff3Result {
  if (oursText === theirsText) {
    return { conflict: false, resolvedText: oursText, chunks: [{ type: 'clean', ours: oursText, theirs: theirsText, merged: oursText }] }
  }
  if (oursText === baseText) {
    return { conflict: false, resolvedText: theirsText, chunks: [{ type: 'clean', ours: oursText, theirs: theirsText, merged: theirsText }] }
  }
  if (theirsText === baseText) {
    return { conflict: false, resolvedText: oursText, chunks: [{ type: 'clean', ours: oursText, theirs: theirsText, merged: oursText }] }
  }

  const baseLines = baseText.split('\n')
  const oursLines = oursText.split('\n')
  const theirsLines = theirsText.split('\n')

  return computeLineDiff3(baseLines, oursLines, theirsLines)
}

function computeLineDiff3(base: string[], ours: string[], theirs: string[]): Diff3Result {
  let bIdx = 0
  let oIdx = 0
  let tIdx = 0

  const chunks: Diff3Chunk[] = []
  let hasConflict = false
  const resolvedLines: string[] = []

  while (bIdx < base.length || oIdx < ours.length || tIdx < theirs.length) {
    // 1. All match
    if (bIdx < base.length && oIdx < ours.length && tIdx < theirs.length &&
        base[bIdx] === ours[oIdx] && base[bIdx] === theirs[tIdx]) {
      const line = base[bIdx]!
      chunks.push({ type: 'clean', ours: line, theirs: line, base: line, merged: line })
      resolvedLines.push(line)
      bIdx++
      oIdx++
      tIdx++
      continue
    }

    // Find next common sync point across base, ours, and theirs
    let foundSync = false
    let syncB = -1
    let syncO = -1
    let syncT = -1

    const maxLookahead = Math.max(base.length - bIdx, ours.length - oIdx, theirs.length - tIdx)

    for (let offset = 1; offset <= maxLookahead; offset++) {
      const targetB = bIdx + offset
      if (targetB < base.length) {
        const line = base[targetB]
        const matchO = ours.indexOf(line!, oIdx)
        const matchT = theirs.indexOf(line!, tIdx)
        if (matchO !== -1 && matchT !== -1) {
          syncB = targetB
          syncO = matchO
          syncT = matchT
          foundSync = true
          break
        }
      }
    }

    if (!foundSync) {
      const oSlice = ours.slice(oIdx).join('\n')
      const tSlice = theirs.slice(tIdx).join('\n')
      const bSlice = base.slice(bIdx).join('\n')

      if (oSlice === tSlice) {
        chunks.push({ type: 'clean', ours: oSlice, theirs: tSlice, base: bSlice, merged: oSlice })
        if (oSlice.length > 0) resolvedLines.push(oSlice)
      } else if (oSlice === bSlice) {
        chunks.push({ type: 'clean', ours: oSlice, theirs: tSlice, base: bSlice, merged: tSlice })
        if (tSlice.length > 0) resolvedLines.push(tSlice)
      } else if (tSlice === bSlice) {
        chunks.push({ type: 'clean', ours: oSlice, theirs: tSlice, base: bSlice, merged: oSlice })
        if (oSlice.length > 0) resolvedLines.push(oSlice)
      } else {
        hasConflict = true
        chunks.push({ type: 'conflict', ours: oSlice, theirs: tSlice, base: bSlice })
      }
      break
    } else {
      const oSlice = ours.slice(oIdx, syncO).join('\n')
      const tSlice = theirs.slice(tIdx, syncT).join('\n')
      const bSlice = base.slice(bIdx, syncB).join('\n')

      if (oSlice === tSlice) {
        chunks.push({ type: 'clean', ours: oSlice, theirs: tSlice, base: bSlice, merged: oSlice })
        if (oSlice.length > 0) resolvedLines.push(oSlice)
      } else if (oSlice === bSlice) {
        chunks.push({ type: 'clean', ours: oSlice, theirs: tSlice, base: bSlice, merged: tSlice })
        if (tSlice.length > 0) resolvedLines.push(tSlice)
      } else if (tSlice === bSlice) {
        chunks.push({ type: 'clean', ours: oSlice, theirs: tSlice, base: bSlice, merged: oSlice })
        if (oSlice.length > 0) resolvedLines.push(oSlice)
      } else {
        hasConflict = true
        chunks.push({ type: 'conflict', ours: oSlice, theirs: tSlice, base: bSlice })
      }

      bIdx = syncB
      oIdx = syncO
      tIdx = syncT
    }
  }

  const consolidatedChunks: Diff3Chunk[] = []
  for (const c of chunks) {
    const last = consolidatedChunks[consolidatedChunks.length - 1]
    if (last && last.type === 'clean' && c.type === 'clean') {
      last.ours += (last.ours ? '\n' : '') + c.ours
      last.theirs += (last.theirs ? '\n' : '') + c.theirs
      last.base = (last.base !== undefined ? last.base + '\n' : '') + (c.base ?? '')
      last.merged = (last.merged !== undefined ? last.merged + '\n' : '') + (c.merged ?? '')
    } else {
      consolidatedChunks.push({ ...c })
    }
  }

  return {
    conflict: hasConflict,
    chunks: consolidatedChunks,
    resolvedText: hasConflict ? undefined : resolvedLines.join('\n'),
  }
}
