import { describe, it, expect } from 'vitest'
import { html, raw, esc, Html } from '../src/markup'

describe('markup', () => {
  it('escapes interpolated strings by default', () => {
    const evil = '<script>alert(1)</script>'
    const out = html`<span>${evil}</span>`.value
    expect(out).toBe('<span>&lt;script&gt;alert(1)&lt;/script&gt;</span>')
  })

  it('escapes double quotes in attribute context', () => {
    const out = html`<div title="${'a"b'}">x</div>`.value
    expect(out).toBe('<div title="a&quot;b">x</div>')
  })

  it('does not re-escape raw() / nested html values', () => {
    const inner = html`<b>${'<ok>'}</b>` // escapes the inner string
    const out = html`<div>${inner}${raw('<hr>')}</div>`.value
    expect(out).toBe('<div><b>&lt;ok&gt;</b><hr></div>')
  })

  it('joins arrays and drops null/undefined/false', () => {
    const items = [html`<li>${'a'}</li>`, html`<li>${'b'}</li>`]
    expect(html`<ul>${items}</ul>`.value).toBe('<ul><li>a</li><li>b</li></ul>')
    expect(html`${false}${null}${undefined}x`.value).toBe('x')
  })

  it('esc handles the four significant characters', () => {
    expect(esc('& < > "')).toBe('&amp; &lt; &gt; &quot;')
  })

  it('Html stringifies to its value', () => {
    expect(String(new Html('<p>hi</p>'))).toBe('<p>hi</p>')
  })
})
