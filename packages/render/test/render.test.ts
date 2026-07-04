// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderToHtml, selectionToOffsets, renderComment, htmlToMarkdown } from '../src/index'

describe('renderToHtml', () => {
  it('renders GFM and carries source positions', () => {
    const md = '# Title\n\nA **bold** word.\n'
    const html = renderToHtml(md)
    expect(html).toContain('<h1')
    expect(html).toMatch(/<strong[^>]*>bold<\/strong>/)
    expect(html).toContain('data-s="0"') // the h1 starts at offset 0
    expect(html).toMatch(/data-e="\d+"/)
  })

  it('renders tables (GFM)', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |\n'
    expect(renderToHtml(md)).toMatch(/<table[^>]*>/)
  })
})

describe('reading enhancements (D19 Tier 1)', () => {
  it('syntax-highlights code fences AND keeps the block source offsets (comments still anchor)', () => {
    const html = renderToHtml('```js\nconst x = 1\n```\n')
    expect(html).toContain('hljs') // highlight.js classes applied
    expect(html).toMatch(/<pre[^>]*data-s="0"[^>]*data-e="\d+"/) // block wrapper keeps its offsets
  })

  it('renders inline math with KaTeX inside a positioned paragraph (still anchorable)', () => {
    const html = renderToHtml('Euler: $e^{i\\pi}+1=0$ done\n')
    expect(html).toContain('class="katex"')
    expect(html).toMatch(/<p[^>]*data-s="0"/) // the containing paragraph keeps its offsets
  })

  it('renders display math with KaTeX', () => {
    expect(renderToHtml('$$\nx^2\n$$\n')).toContain('katex')
  })

  it('gives headings unique id slugs (for the TOC)', () => {
    const html = renderToHtml('# Intro\n\n## Setup\n\n## Setup\n')
    expect(html).toMatch(/<h1[^>]*id="intro"/)
    expect(html).toMatch(/<h2[^>]*id="setup"/)
    expect(html).toMatch(/<h2[^>]*id="setup-1"/) // duplicate heading text → deduped slug
  })

  it('leaves plain prose source positions intact (no anchoring regression)', () => {
    const html = renderToHtml('# Title\n\nplain paragraph\n')
    expect(html).toMatch(/<h1[^>]*data-s="0"/)
    expect(html).toMatch(/<p[^>]*data-s="\d+"[^>]*data-e="\d+"/)
  })
})

describe('comment formatting', () => {
  it('renders a Markdown comment body to HTML', () => {
    const html = renderComment('a **bold** word and `code`')
    expect(html).toMatch(/<strong[^>]*>bold<\/strong>/)
    expect(html).toMatch(/<code[^>]*>code<\/code>/)
  })

  it('does not pass through raw HTML in a comment (XSS-safe)', () => {
    expect(renderComment('<script>alert(1)</script>')).not.toContain('<script>')
  })

  it('converts pasted rich HTML to Markdown', () => {
    const md = htmlToMarkdown('<p>a <strong>bold</strong> and <em>italic</em> with <code>code</code></p>')
    expect(md).toContain('**bold**')
    expect(md).toContain('_italic_')
    expect(md).toContain('`code`')
  })

  it('converts an HTML bullet list to Markdown', () => {
    const md = htmlToMarkdown('<ul><li>one</li><li>two</li></ul>')
    expect(md).toContain('- one')
    expect(md).toContain('- two')
  })
})

describe('selectionToOffsets', () => {
  it('maps a selection inside a paragraph to the correct .md offsets', () => {
    const md = 'The brown fox jumps over.\n'
    const root = document.createElement('div')
    root.innerHTML = renderToHtml(md)
    document.body.appendChild(root)

    // find the text node containing "fox" and select it
    const p = root.querySelector('p')!
    const textNode = p.firstChild as Text
    const i = textNode.data.indexOf('fox')
    const range = document.createRange()
    range.setStart(textNode, i)
    range.setEnd(textNode, i + 3)

    const offsets = selectionToOffsets(root, range, md)
    expect(offsets).not.toBeNull()
    expect(md.slice(offsets!.start, offsets!.end)).toBe('fox')
  })

  it('falls back to the whole block span when the selection crosses inline markers', () => {
    const md = 'A **bold** word.\n'
    const root = document.createElement('div')
    root.innerHTML = renderToHtml(md)
    document.body.appendChild(root)

    // select across the <strong> boundary: rendered text "A bold word" has no ** so the exact slice
    // is not found and the mapping coarsens to the paragraph's source span (documented behavior).
    const p = root.querySelector('p')!
    const range = document.createRange()
    range.setStart(p.firstChild!, 0) // start of "A "
    range.setEnd(p.lastChild!, 3) // into " word"

    const offsets = selectionToOffsets(root, range, md)
    expect(offsets).not.toBeNull()
    expect(md.slice(offsets!.start, offsets!.end)).toContain('**bold**') // coarse: the whole block
  })

  it('maps a selection spanning multiple blocks to the enclosing source range', () => {
    const md = 'First paragraph.\n\nSecond paragraph.\n'
    const root = document.createElement('div')
    root.innerHTML = renderToHtml(md)
    document.body.appendChild(root)

    // select from inside the first <p> across into the second <p> → common ancestor is the root div
    const ps = root.querySelectorAll('p')
    const range = document.createRange()
    range.setStart(ps[0]!.firstChild!, 0)
    range.setEnd(ps[1]!.firstChild!, 6)

    const offsets = selectionToOffsets(root, range, md)
    expect(offsets).not.toBeNull()
    expect(offsets!.start).toBe(0)
    const span = md.slice(offsets!.start, offsets!.end)
    expect(span).toContain('First paragraph')
    expect(span).toContain('Second')
  })

  it('returns null when the selection has no positioned ancestor', () => {
    const root = document.createElement('div') // no rendered content, no data-s/data-e
    document.body.appendChild(root)
    const orphan = document.createTextNode('loose text')
    root.appendChild(orphan)
    const range = document.createRange()
    range.setStart(orphan, 0)
    range.setEnd(orphan, 4)
    expect(selectionToOffsets(root, range, 'loose text')).toBeNull()
  })
})
