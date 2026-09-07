import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export const calloutPluginKey = new PluginKey('MD4LP_CREPE_CALLOUTS')

export const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const
export type AlertType = typeof ALERT_TYPES[number]

export const ALERT_REGEX = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s|$)/i

/**
 * ProseMirror plugin for Milkdown / Crepe:
 * Dynamically decorates GitHub-style callouts (`> [!NOTE]`, `> [!TIP]`, etc.)
 * in edit mode without modifying the underlying markdown AST.
 */
export const crepeCallouts = $prose(() => {
  return new Plugin({
    key: calloutPluginKey,
    props: {
      decorations(state) {
        const decos: Decoration[] = []
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'blockquote') {
            const firstChild = node.firstChild
            if (firstChild && firstChild.isTextblock) {
              const fullText = firstChild.textContent || ''
              const match = fullText.match(ALERT_REGEX)
              if (match && match[1]) {
                const type = match[1].toLowerCase() as AlertType
                decos.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: `markdown-alert markdown-alert-${type}`,
                  })
                )

                let badgeFound = false
                let textOffset = 0
                firstChild.forEach((child) => {
                  if (!badgeFound && child.isText && child.text) {
                    const m = child.text.match(ALERT_REGEX)
                    if (m) {
                      badgeFound = true
                      const trimmed = m[0].trim()
                      const start = child.text.indexOf(trimmed)
                      const from = pos + 2 + textOffset + start
                      const to = from + trimmed.length
                      decos.push(
                        Decoration.inline(from, to, {
                          class: `markdown-alert-badge markdown-alert-badge-${type}`,
                        })
                      )
                    }
                    textOffset += child.text.length
                  }
                })
              }
            }
          }
        })
        return DecorationSet.create(state.doc, decos)
      },
    },
  })
})
