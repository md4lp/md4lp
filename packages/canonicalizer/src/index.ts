import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkStringify, { type Options as StringifyOptions } from 'remark-stringify'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkDirective from 'remark-directive'

/**
 * Frozen, deterministic Markdown canonicalizer for md4lp.
 *
 * Purpose: converge PM-written and AI-written Markdown to ONE canonical style so git diffs
 * stay clean. It is used opt-in (format-on-save / pre-commit), NEVER on the live editor buffer.
 *
 * It does NOT guarantee byte-exact preservation of the input (remark-stringify normalizes by
 * design). Byte-exact preservation of what the user is editing is the editor's job (Family C).
 * What this MUST guarantee is idempotency: canonicalize(canonicalize(x)) === canonicalize(x).
 */
export const STRINGIFY_OPTIONS: Readonly<StringifyOptions> = {
  bullet: '-',
  bulletOther: '*',
  emphasis: '_',
  strong: '*',
  fence: '`',
  fences: true,
  listItemIndent: 'one',
  rule: '-',
  ruleSpaces: false,
  setext: false,
  incrementListMarker: true,
  tightDefinitions: true,
  resourceLink: false,
} as const

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkStringify, STRINGIFY_OPTIONS)
  .freeze()

/** Canonicalize a Markdown string. Deterministic and idempotent. */
export function canonicalize(markdown: string): string {
  return String(processor.processSync(markdown))
}
