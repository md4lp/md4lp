import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import remarkStringify from 'remark-stringify'
import rehypeParse from 'rehype-parse'
import rehypeRemark from 'rehype-remark'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'

/**
 * @md4lp/render — render Markdown to HTML for the review view, carrying SOURCE POSITIONS so a DOM
 * selection in the rendered HTML can be mapped back to character offsets in the `.md` source. That is
 * what lets comments anchor to the Markdown (D16), not to the rendered DOM.
 *
 * Elements get `data-s` / `data-e` attributes = the mdast node's start/end source offsets.
 */

interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  position?: { start?: { offset?: number }; end?: { offset?: number } }
  children?: HastNode[]
}

/** unified plugin: copy each element's source offsets onto data-s / data-e. */
function rehypeSourcePos() {
  return (tree: HastNode): void => {
    const visit = (node: HastNode): void => {
      if (node.type === 'element' && node.position?.start?.offset !== undefined && node.position.end?.offset !== undefined) {
        node.properties = node.properties ?? {}
        node.properties['data-s'] = String(node.position.start.offset)
        node.properties['data-e'] = String(node.position.end.offset)
      }
      for (const child of node.children ?? []) visit(child)
    }
    visit(tree)
  }
}

const textOf = (node: HastNode): string =>
  node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join('')

/** Slugify heading text for an id/anchor (lowercase, spaces→dashes, strip punctuation). */
function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-') || 'section'
  )
}

/** unified plugin: give every heading (h1–h6) a unique `id` slug, so the TOC can link to it. */
function rehypeHeadingIds() {
  return (tree: HastNode): void => {
    const seen = new Map<string, number>()
    const visit = (node: HastNode): void => {
      if (node.type === 'element' && /^h[1-6]$/.test(node.tagName ?? '')) {
        let slug = slugify(textOf(node))
        const n = seen.get(slug) ?? 0
        seen.set(slug, n + 1)
        if (n > 0) slug = `${slug}-${n}`
        node.properties = node.properties ?? {}
        if (node.properties['id'] === undefined) node.properties['id'] = slug
      }
      for (const child of node.children ?? []) visit(child)
    }
    visit(tree)
  }
}

const ALERT_CONFIGS: Record<string, { label: string; icon: string }> = {
  note: { label: 'Note', icon: 'ℹ️' },
  tip: { label: 'Tip', icon: '💡' },
  important: { label: 'Important', icon: '💬' },
  warning: { label: 'Warning', icon: '⚠️' },
  caution: { label: 'Caution', icon: '🛑' },
}

const ALERT_REGEX = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\r?\n|[ \t]*)/i

/** unified plugin: convert GitHub-style alert blockquotes into styled alert cards */
function rehypeGithubAlerts() {
  return (tree: HastNode): void => {
    const visit = (node: HastNode): void => {
      if (node.type === 'element' && node.tagName === 'blockquote') {
        const firstChild = (node.children ?? []).find(c => c.type === 'element' && c.tagName === 'p')
        if (firstChild && firstChild.children && firstChild.children.length > 0) {
          const firstText = firstChild.children[0]
          if (firstText && firstText.type === 'text' && firstText.value) {
            const match = firstText.value.match(ALERT_REGEX)
            if (match && match[1]) {
              const typeKey = match[1].toLowerCase()
              const config = ALERT_CONFIGS[typeKey] ?? { label: match[1], icon: 'ℹ️' }

              node.properties = node.properties ?? {}
              const prevClass = node.properties['className'] as string[] | string | undefined
              const classes = Array.isArray(prevClass)
                ? [...prevClass]
                : typeof prevClass === 'string'
                  ? prevClass.split(/\s+/).filter(Boolean)
                  : []
              classes.push('markdown-alert', `markdown-alert-${typeKey}`)
              node.properties['className'] = classes

              // Remove the alert marker [!TYPE]
              firstText.value = firstText.value.slice(match[0].length)

              // Build title node
              const titleNode: HastNode = {
                type: 'element',
                tagName: 'p',
                properties: { className: ['markdown-alert-title'] },
                children: [
                  {
                    type: 'element',
                    tagName: 'span',
                    properties: { className: ['markdown-alert-icon'] },
                    children: [{ type: 'text', value: `${config.icon} ` }],
                  },
                  {
                    type: 'text',
                    value: config.label,
                  },
                ],
              }

              // If the first text node is empty, remove it
              if (firstText.value.length === 0) {
                firstChild.children.shift()
              }

              // If firstChild paragraph has no children left, remove it from blockquote
              if (firstChild.children.length === 0) {
                const idx = node.children!.indexOf(firstChild)
                if (idx !== -1) {
                  node.children!.splice(idx, 1)
                }
              }

              node.children = [titleNode, ...(node.children ?? [])]
            }
          }
        }
      }
      for (const child of node.children ?? []) visit(child)
    }
    visit(tree)
  }
}

// Reading-experience plugins (D19) run AFTER rehypeSourcePos so the block wrappers keep their
// data-s/data-e source offsets — highlight.js/KaTeX only rewrite the block's INNER content, so
// comments still anchor to the block (the code/equation), never inside the rendered widget.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeSourcePos)
  .use(rehypeHeadingIds)
  .use(rehypeGithubAlerts)
  .use(rehypeHighlight, { detect: true })
  .use(rehypeKatex) // captures KaTeX errors and renders them inline (won't break the pipeline)
  .use(rehypeStringify)
  .freeze()

/** Render Markdown to HTML with source-position data attributes. */
export function renderToHtml(md: string): string {
  return String(processor.processSync(md))
}

export interface OffsetRange {
  start: number
  end: number
}

/**
 * Map a DOM selection (in HTML produced by {@link renderToHtml}) to `.md` source offsets.
 *
 * Single-block selection: find the nearest enclosing element carrying `data-s`/`data-e` (its source
 * span), then locate the selected text within that `.md` slice (falls back to the element span if the
 * exact text isn't found, e.g. it crosses inline markers).
 *
 * Multi-block selection (spans several top-level blocks, e.g. a paragraph into a code block, or several
 * table rows): the common ancestor is the unpositioned `#review` container, so instead anchor from the
 * FIRST selected block's start to the LAST selected block's end. Returns null only if neither endpoint
 * has a positioned ancestor.
 */
export function selectionToOffsets(root: HTMLElement, range: Range, md: string): OffsetRange | null {
  const el = nearestPositioned(range.commonAncestorContainer, root)
  if (el) {
    const s = Number(el.getAttribute('data-s'))
    const e = Number(el.getAttribute('data-e'))
    if (!Number.isFinite(s) || !Number.isFinite(e)) return null

    const selected = range.toString()
    if (selected.length > 0) {
      const slice = md.slice(s, e)
      const rel = slice.indexOf(selected)
      if (rel >= 0) return { start: s + rel, end: s + rel + selected.length }
    }
    return { start: s, end: e } // coarse fallback: the whole element span
  }

  // No single positioned ancestor → the selection crosses block boundaries. Span the enclosing range.
  const startEl = nearestPositioned(range.startContainer, root)
  const endEl = nearestPositioned(range.endContainer, root)
  if (startEl && endEl) {
    const s = Number(startEl.getAttribute('data-s'))
    const e = Number(endEl.getAttribute('data-e'))
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) return { start: s, end: e }
  }
  return null
}

function nearestPositioned(node: Node | null, root: HTMLElement): HTMLElement | null {
  let cur: Node | null = node
  while (cur && cur !== root.parentNode) {
    if (cur instanceof HTMLElement && cur.hasAttribute('data-s') && cur.hasAttribute('data-e')) return cur
    cur = cur.parentNode
  }
  return null
}

// --- Comments: Markdown bodies (formatting without an editor) ---

const commentProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeStringify).freeze()

/** Render a comment body (Markdown) to HTML. Raw HTML is dropped by remark-rehype, so this is XSS-safe. */
export function renderComment(md: string): string {
  return String(commentProcessor.processSync(md))
}

const htmlToMd = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify, { bullet: '-', emphasis: '_', strong: '*', fences: true, fence: '`' })
  .freeze()

/**
 * Convert pasted rich HTML (e.g. clipboard `text/html` from another app) to Markdown, so a comment
 * keeps bold/italic/lists/code without a rich editor. Used on paste into the plain comment textarea.
 */
export function htmlToMarkdown(html: string): string {
  return String(htmlToMd.processSync(html)).trim()
}
