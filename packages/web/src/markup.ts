/**
 * A tiny HTML templating helper that escapes interpolations BY DEFAULT, so the Review sidebar can't
 * be XSS'd by a username/comment/quote unless something is explicitly marked trusted via `raw()`.
 * Replaces hand-placed `esc(...)` calls (correct-by-discipline) with correct-by-construction escaping.
 */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

/** Escape the HTML-significant characters in a string. */
export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ESC[c]!)

/** Wrapper marking a string as already-safe HTML (it won't be re-escaped when interpolated). */
export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value
  }
}

/** Mark trusted HTML (e.g. the output of the Markdown comment renderer) so `html` won't escape it. */
export const raw = (s: string): Html => new Html(s)

type Interpolable = string | number | Html | Interpolable[] | null | undefined | false

function render(v: Interpolable): string {
  if (v === null || v === undefined || v === false) return ''
  if (v instanceof Html) return v.value
  if (Array.isArray(v)) return v.map(render).join('')
  return esc(String(v))
}

/**
 * Tagged template that auto-escapes every interpolation. Strings/numbers are escaped; `Html`/`raw()`
 * values and nested `html\`\`` results pass through unescaped; arrays are joined; null/undefined/false
 * render to nothing (handy for conditionals).
 */
export function html(strings: TemplateStringsArray, ...values: Interpolable[]): Html {
  let out = strings[0]!
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1]!
  return new Html(out)
}
