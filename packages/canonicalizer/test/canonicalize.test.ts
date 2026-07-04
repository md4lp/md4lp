import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { canonicalize } from '../src/index'

const roundtripDir = fileURLToPath(new URL('../../../test/corpus/roundtrip', import.meta.url))
const fixtures = readdirSync(roundtripDir).filter((f) => f.endsWith('.md')).sort()

describe('canonicalizer idempotency (AC0.2)', () => {
  it('has fixtures to test', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const name of fixtures) {
    it(`canonicalize is idempotent on ${name}`, () => {
      const src = readFileSync(`${roundtripDir}/${name}`, 'utf8')
      const once = canonicalize(src)
      const twice = canonicalize(once)
      expect(twice).toBe(once)
    })
  }
})

// Style-variant pairs: different but semantically-equal Markdown must collapse to one canonical form.
const convergencePairs: ReadonlyArray<{ name: string; a: string; b: string }> = [
  {
    name: 'list markers (* vs -)',
    a: '* item one\n* item two\n',
    b: '- item one\n- item two\n',
  },
  {
    name: 'emphasis/strong markers',
    a: 'This is *emphasized* and __strong__ text.\n',
    b: 'This is _emphasized_ and **strong** text.\n',
  },
  {
    name: 'table column spacing + delimiter style',
    a: '| a | b |\n|---|---|\n| 1 | 2 |\n',
    b: '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n',
  },
  {
    name: 'heading whitespace + blank-line noise',
    a: '#   Title\n\n\n\nBody paragraph.\n',
    b: '# Title\n\nBody paragraph.\n',
  },
]

describe('canonicalizer convergence (AC0.3)', () => {
  for (const { name, a, b } of convergencePairs) {
    it(`converges: ${name}`, () => {
      expect(canonicalize(a)).toBe(canonicalize(b))
    })
  }
})

describe('canonicalizer does not corrupt frontmatter (anti-DesktopCommander-#440)', () => {
  it('keeps the YAML frontmatter block and its keys intact', () => {
    const src = readFileSync(`${roundtripDir}/02-frontmatter.md`, 'utf8')
    const out = canonicalize(src)
    expect(out.startsWith('---\n')).toBe(true)
    expect(out).toContain('title: Test Doc')
    expect(out).toContain('key: "value with: a colon"')
    // The frontmatter must not be collapsed onto a single line.
    const fm = out.slice(0, out.indexOf('---', 3))
    expect(fm.split('\n').length).toBeGreaterThan(5)
  })
})
