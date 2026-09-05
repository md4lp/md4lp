import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import 'katex/dist/katex.min.css'
import '../review.css'
import { renderToHtml, selectionToOffsets, renderComment } from '@md4lp/render'
import { api, type DocumentTreeItem, type DocumentInfo, type ConflictPreview, type ConflictBlock } from '../services/api'
import type { Sidecar } from '../types'
import { locateRange } from '../highlight'
import { router } from '../router'

export class WorkspaceView {
  private container: HTMLElement
  private projectSlug: string
  private projectId: string = ''
  private docPath: string = ''
  private currentDoc: DocumentInfo | null = null
  private tree: DocumentTreeItem[] = []
  private mode: 'read' | 'edit' = 'read'
  private crepe: Crepe | null = null
  private autosaveTimer: any = null
  private sse: EventSource | null = null
  private comments: Sidecar[] = []
  private activeThreadId: string | null = null
  private pendingSelection: { start: number; end: number; quote: string } | null = null

  constructor(container: HTMLElement, projectSlug: string, initialDocPath?: string) {
    this.container = container
    this.projectSlug = projectSlug
    this.docPath = initialDocPath || ''
  }

  async render(): Promise<void> {
    this.container.innerHTML = `
      <div style="display: flex; height: 100vh; flex-direction: column; background: var(--bg-app);">
        
        <!-- Workspace Navigation Header -->
        <header style="position: relative; height: var(--header-height); background: var(--bg-surface); border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between; padding: 0 16px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <button id="btnBackToDashboard" class="btn btn-ghost" title="Back to Dashboard" style="font-size: 14px; padding: 4px 8px;">←</button>
            <span style="font-size: 18px;">📁</span>
            <div>
              <span id="headerProjectName" style="font-weight: 700; font-size: 14px; color: var(--text-primary);">...</span>
              <span id="headerDocPath" style="font-size: 12px; color: var(--text-muted); margin-left: 6px;"></span>
            </div>
          </div>

          <!-- Flash Banner in Header (Centered absolutely) -->
          <div id="workspaceHeaderFlash" style="display: none; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); align-items: center; gap: 8px; font-size: 12px; font-weight: 500; padding: 6px 16px; border-radius: var(--radius-full); box-shadow: var(--shadow-sm); z-index: 10; pointer-events: none; transition: all 0.2s ease;"></div>

          <!-- Central Mode / Status -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="display: flex; background: var(--bg-app); padding: 2px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
              <button id="btnModeRead" class="btn btn-ghost" style="padding: 4px 10px; font-size: 12px; border-radius: var(--radius-sm);">📖 Read & Review</button>
              <button id="btnModeEdit" class="btn btn-ghost" style="padding: 4px 10px; font-size: 12px; border-radius: var(--radius-sm);">✏️ Edit</button>
            </div>

            <div id="saveStatusBadge" class="badge badge-blue" style="font-size: 11px; display: none;">Saved</div>
            <button id="btnPublish" class="btn btn-primary" style="display: none; padding: 4px 12px; font-size: 12px;">
              Publish to Main ↗
            </button>
          </div>

          <!-- Actions & Comments Toggle -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="btnProjectSettings" class="btn btn-ghost" title="Share repository & manage access" style="font-size: 13px; padding: 4px 8px;">👥 Share</button>
            <button id="btnToggleComments" class="btn btn-ghost" style="font-size: 12px; gap: 4px;">
              💬 <span id="commentsCountBadge" class="badge badge-blue" style="font-size: 10px;">0</span>
            </button>
          </div>
        </header>

        <!-- Main Split Workspace Layout -->
        <div style="flex: 1; display: flex; min-height: 0;">
          
          <!-- Left Directory Explorer Sidebar -->
          <aside style="width: var(--sidebar-width); background: var(--bg-sidebar); border-right: 1px solid var(--border-subtle); display: flex; flex-direction: column; overflow: hidden;">
            
            <div style="padding: 12px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-subtle);">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted);">Explorer</span>
              <div style="display: flex; gap: 4px;">
                <button id="btnNewDoc" class="btn btn-ghost" title="New Document" style="padding: 2px 6px; font-size: 12px;">+📄</button>
              </div>
            </div>

            <!-- New Document Inline Form -->
            <div id="newDocForm" style="display: none; padding: 8px 12px; background: var(--bg-surface); border-bottom: 1px solid var(--border-subtle);">
              <input id="inputNewDocPath" class="input" type="text" placeholder="path/to/document.md" style="font-size: 12px; padding: 4px 8px; margin-bottom: 6px;" />
              <div style="display: flex; justify-content: flex-end; gap: 4px;">
                <button id="btnCancelNewDoc" class="btn btn-ghost" style="padding: 2px 6px; font-size: 11px;">Cancel</button>
                <button id="btnSubmitNewDoc" class="btn btn-primary" style="padding: 2px 8px; font-size: 11px;">Create</button>
              </div>
            </div>

            <div id="treeContainer" style="flex: 1; overflow-y: auto; padding: 8px 4px;"></div>
          </aside>

          <!-- Center Content Area -->
          <main style="flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--bg-surface); position: relative;">
            
            <!-- Read / Render Pane -->
            <div id="readPane" style="flex: 1; overflow-y: auto; padding: 32px 48px; max-width: 900px; width: 100%; margin: 0 auto; user-select: text;">
              <div id="readContent" class="prose"></div>
            </div>

            <!-- Edit Pane (Crepe WYSIWYG) -->
            <div id="editPane" style="flex: 1; overflow-y: auto; display: none; padding: 24px 32px; max-width: 900px; width: 100%; margin: 0 auto;">
              <div id="crepeContainer"></div>
            </div>

            <!-- Floating Selection Popover for Comments -->
            <div id="selectionPopover" style="display: none; position: absolute; z-index: 100; background: var(--bg-surface); border: 1px solid var(--border-default); box-shadow: var(--shadow-lg); border-radius: var(--radius-md); padding: 4px; gap: 4px;">
              <button id="btnPopAddComment" class="btn btn-ghost" style="font-size: 12px; padding: 4px 8px;">💬 Comment</button>
            </div>

          </main>

          <!-- Right Comments & Suggestions Drawer -->
          <aside id="commentsDrawer" style="width: var(--drawer-width); background: var(--bg-surface); border-left: 1px solid var(--border-subtle); display: flex; flex-direction: column; overflow: hidden;">
            <div style="padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
              <h3 style="margin: 0; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary);">Comments & Suggestions</h3>
              <button id="btnCloseDrawer" class="btn btn-ghost" style="padding: 2px 6px; font-size: 12px;">✕</button>
            </div>

            <!-- New Comment Box (when text is selected) -->
            <div id="newCommentBox" style="display: none; padding: 12px; background: var(--bg-app); border-bottom: 1px solid var(--border-subtle);">
              <div id="commentSelectedQuote" style="font-size: 11px; font-style: italic; color: var(--text-muted); margin-bottom: 6px; border-left: 2px solid var(--accent-primary); padding-left: 6px; max-height: 40px; overflow: hidden; text-overflow: ellipsis;"></div>
              
              <textarea id="inputCommentBody" class="input" rows="2" placeholder="Leave a review comment..." style="resize: vertical; margin-bottom: 6px;"></textarea>
              
              <div style="margin-bottom: 8px;">
                <input id="inputSuggestionText" class="input" type="text" placeholder="Optional replacement suggestion..." style="font-size: 11px;" />
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 6px;">
                <button id="btnCancelNewComment" class="btn btn-ghost" style="font-size: 11px; padding: 3px 8px;">Cancel</button>
                <button id="btnSubmitNewComment" class="btn btn-primary" style="font-size: 11px; padding: 3px 10px;">Post</button>
              </div>
            </div>

            <!-- Comments List -->
            <div id="commentsListContainer" style="flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px;"></div>
          </aside>

        </div>
      </div>

      <!-- 3-Way Merge Conflict Resolution Dialog -->
      <dialog id="conflictDialog" style="max-width: 750px; width: 90%; border: 1px solid var(--border-default); border-radius: var(--radius-lg); background: var(--bg-surface); color: var(--text-primary); padding: 24px; box-shadow: var(--shadow-lg);">
        <h3 style="margin-top: 0; color: var(--danger-text); font-size: 16px;">⚠️ Conflict Detected Upon Publication</h3>
        <p style="font-size: 13px; color: var(--text-secondary);">
          The document was updated on <code>main</code> while you were editing. Review and resolve each conflicting block below:
        </p>

        <div id="conflictBlocksContainer" style="max-height: 380px; overflow-y: auto; margin: 16px 0; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 12px; background: var(--bg-app); display: flex; flex-direction: column; gap: 12px;"></div>

        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button id="btnCancelConflict" class="btn btn-ghost">Cancel</button>
          <button id="btnResolveAndPublish" class="btn btn-primary">Apply Resolution & Publish</button>
        </div>
      </dialog>
    `

    this.bindEvents()
    await this.initWorkspace()
  }

  private async initWorkspace(): Promise<void> {
    try {
      const projsRes = await api.listProjects()
      const currentProj = projsRes.projects.find((p) => p.slug === this.projectSlug)
      if (!currentProj) {
        router.navigate('/projects')
        return
      }

      this.projectId = currentProj.id
      const headerName = this.container.querySelector<HTMLElement>('#headerProjectName')!
      headerName.textContent = currentProj.name

      await this.refreshTree()

      // If initial docPath was provided, open it, else open first document
      if (this.docPath) {
        await this.openDocument(this.docPath)
      } else if (this.tree.length > 0) {
        const firstDoc = this.findFirstDoc(this.tree)
        if (firstDoc) {
          await this.openDocument(firstDoc.path)
        }
      }

      this.setupSSE()
    } catch (err) {
      console.error('Failed to init workspace:', err)
      router.navigate('/projects')
    }
  }

  private findFirstDoc(items: DocumentTreeItem[]): DocumentTreeItem | null {
    for (const it of items) {
      if (it.type === 'file') return it
      if (it.children) {
        const found = this.findFirstDoc(it.children)
        if (found) return found
      }
    }
    return null
  }

  private async refreshTree(): Promise<void> {
    const res = await api.listTree(this.projectId)
    this.tree = res.tree || []
    this.renderTree()
  }

  private renderTree(): void {
    const container = this.container.querySelector<HTMLElement>('#treeContainer')!
    if (this.tree.length === 0) {
      container.innerHTML = `<div style="padding: 12px; font-size: 12px; color: var(--text-muted); text-align: center;">No documents yet.</div>`
      return
    }

    container.innerHTML = this.buildTreeHtml(this.tree)

    container.querySelectorAll<HTMLElement>('.tree-file').forEach((el) => {
      el.addEventListener('click', async () => {
        const path = el.getAttribute('data-path')
        if (path) {
          await this.openDocument(path)
        }
      })
    })
  }

  private buildTreeHtml(items: DocumentTreeItem[], depth = 0): string {
    return items.map((it) => {
      const paddingLeft = 12 + depth * 14
      const isSelected = it.path === this.docPath

      if (it.type === 'directory') {
        return `
          <div class="tree-dir" style="margin-bottom: 2px;">
            <div style="padding: 4px 8px 4px ${paddingLeft}px; font-size: 12px; font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
              📁 <span>${it.name}</span>
            </div>
            <div>${it.children ? this.buildTreeHtml(it.children, depth + 1) : ''}</div>
          </div>
        `
      }

      return `
        <div class="tree-file" data-path="${it.path}" style="padding: 4px 8px 4px ${paddingLeft}px; font-size: 12px; display: flex; align-items: center; gap: 6px; cursor: pointer; border-radius: var(--radius-sm); margin-bottom: 1px; color: ${isSelected ? 'var(--accent-primary)' : 'var(--text-primary)'}; background: ${isSelected ? 'var(--accent-subtle)' : 'transparent'}; font-weight: ${isSelected ? '600' : '400'};">
          📄 <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${it.name}</span>
        </div>
      `
    }).join('')
  }

  private async openDocument(path: string): Promise<void> {
    this.docPath = path
    const headerDoc = this.container.querySelector<HTMLElement>('#headerDocPath')!
    headerDoc.textContent = `› ${path}`

    // Update URL hash without full reload / triggering hashchange re-render
    window.history.replaceState(null, '', `#/p/${this.projectSlug}/${path}`)

    this.renderTree()

    const res = await api.getDocument(this.projectId, path)
    this.currentDoc = res

    await this.loadComments()
    this.renderReadMode()
  }

  private renderReadMode(): void {
    this.mode = 'read'
    const readPane = this.container.querySelector<HTMLElement>('#readPane')!
    const editPane = this.container.querySelector<HTMLElement>('#editPane')!
    const btnRead = this.container.querySelector<HTMLButtonElement>('#btnModeRead')!
    const btnEdit = this.container.querySelector<HTMLButtonElement>('#btnModeEdit')!
    const btnPublish = this.container.querySelector<HTMLButtonElement>('#btnPublish')!
    const statusBadge = this.container.querySelector<HTMLElement>('#saveStatusBadge')!

    readPane.style.display = 'block'
    editPane.style.display = 'none'
    btnPublish.style.display = 'none'
    statusBadge.style.display = 'none'

    btnRead.classList.add('btn-primary')
    btnRead.classList.remove('btn-ghost')
    btnEdit.classList.add('btn-ghost')
    btnEdit.classList.remove('btn-primary')

    const readContent = this.container.querySelector<HTMLElement>('#readContent')!
    const rawMd = this.currentDoc?.content || ''
    readContent.innerHTML = renderToHtml(rawMd)

    // Highlight comments in Read Mode
    this.applyCommentHighlights()
  }

  private flashTimer: any = null
  private showFlash(message: string, type: 'success' | 'error' = 'success'): void {
    const flash = this.container.querySelector<HTMLElement>('#workspaceHeaderFlash')
    if (!flash) return
    if (this.flashTimer) clearTimeout(this.flashTimer)

    flash.textContent = message
    flash.style.display = 'inline-flex'
    flash.style.background = type === 'success' ? 'var(--primary-subtle, #ecfdf5)' : 'var(--danger-bg, #fef2f2)'
    flash.style.color = type === 'success' ? 'var(--accent-primary, #059669)' : 'var(--danger-text, #dc2626)'
    flash.style.border = `1px solid ${type === 'success' ? 'var(--accent-primary, #10b981)' : 'var(--danger-border, #fca5a5)'}`

    this.flashTimer = setTimeout(() => {
      flash.style.display = 'none'
    }, 3500)
  }

  private async switchMode(mode: 'read' | 'edit'): Promise<void> {
    if (this.mode === mode) return
    if (mode === 'edit') {
      try {
        await api.acquireLock(this.projectId, this.docPath)
        this.mode = 'edit'
        this.renderEditMode()
      } catch (err: any) {
        this.showFlash(err.message || 'Could not acquire edit lock', 'error')
      }
    } else {
      if (this.crepe) {
        const md = this.crepe.getMarkdown()
        await api.saveDraft(this.projectId, this.docPath, md)
        await api.releaseLock(this.projectId, this.docPath)
        if (this.currentDoc) {
          this.currentDoc.content = md
        }
      }
      this.mode = 'read'
      this.renderReadMode()
    }
  }

  private renderEditMode(): void {
    const readPane = this.container.querySelector<HTMLElement>('#readPane')!
    const editPane = this.container.querySelector<HTMLElement>('#editPane')!
    const btnRead = this.container.querySelector<HTMLButtonElement>('#btnModeRead')!
    const btnEdit = this.container.querySelector<HTMLButtonElement>('#btnModeEdit')!
    const btnPublish = this.container.querySelector<HTMLButtonElement>('#btnPublish')!
    const statusBadge = this.container.querySelector<HTMLElement>('#saveStatusBadge')!

    readPane.style.display = 'none'
    editPane.style.display = 'block'
    btnPublish.style.display = 'inline-flex'
    statusBadge.style.display = 'inline-flex'
    statusBadge.textContent = 'Editing (Autosaving)'

    btnEdit.classList.add('btn-primary')
    btnEdit.classList.remove('btn-ghost')
    btnRead.classList.add('btn-ghost')
    btnRead.classList.remove('btn-primary')

    const crepeContainer = this.container.querySelector<HTMLElement>('#crepeContainer')!
    crepeContainer.innerHTML = ''

    this.crepe = new Crepe({
      root: crepeContainer,
      defaultValue: this.currentDoc?.content || '',
    })

    this.crepe.create().then(() => {
      this.crepe?.on((listener) => {
        listener.markdownUpdated((_, markdown) => {
          if (this.autosaveTimer) clearTimeout(this.autosaveTimer)
          statusBadge.textContent = 'Saving...'
          this.autosaveTimer = setTimeout(async () => {
            try {
              await api.saveDraft(this.projectId, this.docPath, markdown)
              statusBadge.textContent = 'Draft Saved'
            } catch (err) {
              statusBadge.textContent = 'Save Error'
            }
          }, 800)
        })
      })
    })
  }

  private async loadComments(): Promise<void> {
    try {
      const res = await api.getComments(this.projectId, this.docPath)
      this.comments = res.comments || []
      const countEl = this.container.querySelector<HTMLElement>('#commentsCountBadge')!
      countEl.textContent = String(this.comments.length)
      this.renderCommentsDrawer()
    } catch {
      this.comments = []
    }
  }

  private applyCommentHighlights(): void {
    const readContent = this.container.querySelector<HTMLElement>('#readContent')!
    for (const sc of this.comments) {
      if (sc.resolution?.status === 'intact' || sc.resolution?.status === 'moved') {
        const quote = sc.comment.anchor?.quote || ''
        if (quote) {
          const range = locateRange(readContent, quote, sc.resolution.start)
          if (range) {
            const span = document.createElement('mark')
            span.className = `comment-highlight-${sc.comment.id}`
            span.style.background = 'rgba(254, 240, 138, 0.4)'
            span.style.borderBottom = '2px solid #eab308'
            try {
              range.surroundContents(span)
            } catch {}
          }
        }
      }
    }
  }

  private renderCommentsDrawer(): void {
    const list = this.container.querySelector<HTMLElement>('#commentsListContainer')!
    if (this.comments.length === 0) {
      list.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 12px;">No comments yet on this document.</div>`
      return
    }

    list.innerHTML = this.comments.map((sc) => {
      const c = sc.comment
      const isResolved = c.status === 'resolved'

      return `
        <div class="comment-thread-card" data-id="${c.id}" style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 12px; box-shadow: var(--shadow-sm); opacity: ${isResolved ? '0.6' : '1'};">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
            <div>
              <span style="font-weight: 600; font-size: 12px; color: var(--text-primary);">${c.author || 'Author'}</span>
            </div>
            ${isResolved ? '<span class="badge badge-green" style="font-size: 9px;">Resolved</span>' : ''}
          </div>

          <div style="font-size: 13px; color: var(--text-primary); margin-bottom: 8px; line-height: 1.4;">${renderComment(c.body)}</div>

          ${c.suggestion ? `
            <div style="background: var(--accent-subtle); border-left: 2px solid var(--accent-primary); border-radius: var(--radius-sm); padding: 6px 8px; margin-bottom: 8px; font-size: 11px;">
              <div style="font-weight: 600; color: var(--accent-primary); margin-bottom: 2px;">💡 Suggested Replacement:</div>
              <pre style="margin: 0; font-family: var(--font-mono); white-space: pre-wrap;">${c.suggestion}</pre>
            </div>
            ${!isResolved ? `
              <div style="display: flex; gap: 6px; justify-content: flex-end; margin-bottom: 8px;">
                <button class="btn btn-ghost btn-reject-sugg" data-owner="${sc.owner}" data-id="${c.id}" style="font-size: 11px; padding: 2px 6px;">Reject</button>
                <button class="btn btn-primary btn-apply-sugg" data-owner="${sc.owner}" data-id="${c.id}" style="font-size: 11px; padding: 2px 8px;">Apply</button>
              </div>
            ` : ''}
          ` : ''}

          <!-- Replies List -->
          ${c.replies && c.replies.length > 0 ? `
            <div style="display: flex; flex-direction: column; gap: 6px; margin: 8px 0; padding-left: 10px; border-left: 1px solid var(--border-subtle);">
              ${c.replies.map((r: any) => `
                <div style="font-size: 11px;">
                  <b>${r.author || 'User'}:</b> ${r.body}
                </div>
              `).join('')}
            </div>
          ` : ''}

          <!-- Reply Box Trigger -->
          ${!isResolved ? `
            <div style="display: flex; gap: 4px; margin-top: 6px;">
              <input class="input input-reply" type="text" placeholder="Write a reply..." style="font-size: 11px; padding: 3px 6px;" />
              <button class="btn btn-ghost btn-send-reply" data-owner="${sc.owner}" data-id="${c.id}" style="font-size: 11px; padding: 2px 6px;">Reply</button>
            </div>
          ` : ''}
        </div>
      `
    }).join('')

    // Bind suggestion apply/reject
    list.querySelectorAll<HTMLButtonElement>('.btn-apply-sugg').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const owner = btn.getAttribute('data-owner')!
        const id = btn.getAttribute('data-id')!
        try {
          await api.applySuggestion(this.projectId, this.docPath, owner, id)
          this.showFlash('Suggestion applied successfully', 'success')
          await this.openDocument(this.docPath)
        } catch (err: any) {
          this.showFlash(err.message || 'Error applying suggestion', 'error')
        }
      })
    })

    list.querySelectorAll<HTMLButtonElement>('.btn-reject-sugg').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const owner = btn.getAttribute('data-owner')!
        const id = btn.getAttribute('data-id')!
        try {
          await api.rejectSuggestion(this.projectId, this.docPath, owner, id)
          this.showFlash('Suggestion rejected', 'success')
          await this.loadComments()
        } catch (err: any) {
          this.showFlash(err.message || 'Error rejecting suggestion', 'error')
        }
      })
    })

    list.querySelectorAll<HTMLButtonElement>('.btn-send-reply').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const owner = btn.getAttribute('data-owner')!
        const id = btn.getAttribute('data-id')!
        const card = btn.closest('.comment-thread-card')!
        const input = card.querySelector<HTMLInputElement>('.input-reply')!
        const replyText = input.value.trim()
        if (!replyText) return
        try {
          await api.addReply(this.projectId, this.docPath, owner, id, replyText)
          input.value = ''
          await this.loadComments()
        } catch (err: any) {
          this.showFlash(err.message || 'Error adding reply', 'error')
        }
      })
    })
  }

  private setupSSE(): void {
    if (typeof EventSource === 'undefined') return
    if (this.sse) this.sse.close()
    try {
      this.sse = new EventSource('/api/events')
      this.sse.onmessage = async (e) => {
        try {
          const data = JSON.parse(e.data)
          if (data.projectId && data.projectId !== this.projectId) return
          if (data.type === 'comments' && data.file === this.docPath) {
            await this.loadComments()
          } else if (data.type === 'doc' && data.file === this.docPath && this.mode === 'read') {
            const res = await api.getDocument(this.projectId, this.docPath)
            this.currentDoc = res
            this.renderReadMode()
          }
        } catch {}
      }
    } catch {}
  }

  private bindEvents(): void {
    const btnBack = this.container.querySelector<HTMLButtonElement>('#btnBackToDashboard')!
    const btnRead = this.container.querySelector<HTMLButtonElement>('#btnModeRead')!
    const btnEdit = this.container.querySelector<HTMLButtonElement>('#btnModeEdit')!
    const btnSettings = this.container.querySelector<HTMLButtonElement>('#btnProjectSettings')!
    const btnPublish = this.container.querySelector<HTMLButtonElement>('#btnPublish')!

    const btnNewDoc = this.container.querySelector<HTMLButtonElement>('#btnNewDoc')!
    const newDocForm = this.container.querySelector<HTMLElement>('#newDocForm')!
    const btnCancelNewDoc = this.container.querySelector<HTMLButtonElement>('#btnCancelNewDoc')!
    const btnSubmitNewDoc = this.container.querySelector<HTMLButtonElement>('#btnSubmitNewDoc')!
    const inputNewDocPath = this.container.querySelector<HTMLInputElement>('#inputNewDocPath')!

    const drawer = this.container.querySelector<HTMLElement>('#commentsDrawer')!
    const btnToggleComments = this.container.querySelector<HTMLButtonElement>('#btnToggleComments')!
    const btnCloseDrawer = this.container.querySelector<HTMLButtonElement>('#btnCloseDrawer')!

    const popover = this.container.querySelector<HTMLElement>('#selectionPopover')!
    const btnPopAddComment = this.container.querySelector<HTMLButtonElement>('#btnPopAddComment')!
    const newCommentBox = this.container.querySelector<HTMLElement>('#newCommentBox')!
    const quoteDisplay = this.container.querySelector<HTMLElement>('#commentSelectedQuote')!
    const inputCommentBody = this.container.querySelector<HTMLTextAreaElement>('#inputCommentBody')!
    const inputSuggestionText = this.container.querySelector<HTMLInputElement>('#inputSuggestionText')!
    const btnSubmitNewComment = this.container.querySelector<HTMLButtonElement>('#btnSubmitNewComment')!
    const btnCancelNewComment = this.container.querySelector<HTMLButtonElement>('#btnCancelNewComment')!

    const readPane = this.container.querySelector<HTMLElement>('#readPane')!

    btnBack.addEventListener('click', () => router.navigate('/projects'))
    btnSettings.addEventListener('click', () => router.navigate(`/p/${this.projectSlug}/settings`))

    btnRead.addEventListener('click', () => this.switchMode('read'))
    btnEdit.addEventListener('click', () => this.switchMode('edit'))

    btnToggleComments.addEventListener('click', () => {
      drawer.style.display = drawer.style.display === 'none' ? 'flex' : 'none'
    })
    btnCloseDrawer.addEventListener('click', () => {
      drawer.style.display = 'none'
    })

    btnNewDoc.addEventListener('click', () => {
      newDocForm.style.display = 'block'
      inputNewDocPath.focus()
    })
    btnCancelNewDoc.addEventListener('click', () => {
      newDocForm.style.display = 'none'
      inputNewDocPath.value = ''
    })
    btnSubmitNewDoc.addEventListener('click', async () => {
      const path = inputNewDocPath.value.trim()
      if (!path) return
      try {
        await api.createDocument(this.projectId, path, `# ${path}\n\nStart writing document content here.`)
        newDocForm.style.display = 'none'
        inputNewDocPath.value = ''
        this.showFlash('Document created successfully', 'success')
        await this.refreshTree()
        await this.openDocument(path)
      } catch (err: any) {
        this.showFlash(err.message || 'Error creating document', 'error')
      }
    })

    // Selection Handling for Comments in Read Mode
    readPane.addEventListener('mouseup', () => {
      if (this.mode !== 'read') return
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        popover.style.display = 'none'
        return
      }

      const range = selection.getRangeAt(0)
      const rawMd = this.currentDoc?.content || ''
      const offsets = selectionToOffsets(readPane, range, rawMd)
      if (offsets && offsets.start !== offsets.end) {
        this.pendingSelection = {
          start: offsets.start,
          end: offsets.end,
          quote: selection.toString(),
        }

        const rect = range.getBoundingClientRect()
        popover.style.display = 'flex'
        popover.style.left = `${rect.left + window.scrollX}px`
        popover.style.top = `${rect.bottom + window.scrollY + 6}px`
      } else {
        popover.style.display = 'none'
      }
    })

    btnPopAddComment.addEventListener('click', () => {
      popover.style.display = 'none'
      if (!this.pendingSelection) return
      drawer.style.display = 'flex'
      newCommentBox.style.display = 'block'
      quoteDisplay.textContent = `"${this.pendingSelection.quote}"`
      inputSuggestionText.value = this.pendingSelection.quote
      inputCommentBody.focus()
    })

    btnCancelNewComment.addEventListener('click', () => {
      newCommentBox.style.display = 'none'
      this.pendingSelection = null
      inputCommentBody.value = ''
      inputSuggestionText.value = ''
    })

    btnSubmitNewComment.addEventListener('click', async () => {
      if (!this.pendingSelection) return
      const body = inputCommentBody.value.trim()
      if (!body) return
      const suggestion = inputSuggestionText.value.trim() || undefined

      try {
        await api.addComment(
          this.projectId,
          this.docPath,
          this.pendingSelection.start,
          this.pendingSelection.end,
          body,
          suggestion,
        )
        newCommentBox.style.display = 'none'
        inputCommentBody.value = ''
        inputSuggestionText.value = ''
        this.pendingSelection = null
        this.showFlash('Comment posted successfully', 'success')
        await this.loadComments()
      } catch (err: any) {
        this.showFlash(err.message || 'Error creating comment', 'error')
      }
    })

    // Publish to Main
    btnPublish.addEventListener('click', async () => {
      try {
        await api.publishDocument(this.projectId, this.docPath)
        this.showFlash('Published successfully to main!', 'success')
        await this.switchMode('read')
      } catch (err: any) {
        if (err.chunks || err.message?.includes('conflict')) {
          this.showConflictDialog(err.chunks ? err : { hasConflict: true, baseOid: '', currentMainHead: '', chunks: [] })
        } else {
          this.showFlash(err.message || 'Error publishing document', 'error')
        }
      }
    })
  }

  private showConflictDialog(conflict: ConflictPreview): void {
    const dialog = this.container.querySelector<HTMLDialogElement>('#conflictDialog')!
    const container = this.container.querySelector<HTMLElement>('#conflictBlocksContainer')!
    const btnCancel = this.container.querySelector<HTMLButtonElement>('#btnCancelConflict')!
    const btnResolve = this.container.querySelector<HTMLButtonElement>('#btnResolveAndPublish')!

    container.innerHTML = (conflict.chunks || []).map((c: ConflictBlock, i: number) => {
      return `
        <div style="background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 12px;">
          <div style="font-weight: 600; font-size: 12px; margin-bottom: 8px;">Conflict Block #${i + 1} (${c.type})</div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
            <div style="background: var(--accent-subtle); padding: 8px; border-radius: var(--radius-sm); font-size: 11px;">
              <b style="color: var(--accent-primary);">Your Version (Draft):</b>
              <pre style="margin: 4px 0 0; font-family: var(--font-mono);">${c.ours}</pre>
            </div>
            <div style="background: var(--danger-bg); padding: 8px; border-radius: var(--radius-sm); font-size: 11px;">
              <b style="color: var(--danger-text);">Remote Version (Main):</b>
              <pre style="margin: 4px 0 0; font-family: var(--font-mono);">${c.theirs}</pre>
            </div>
          </div>

          <div style="display: flex; gap: 8px; align-items: center;">
            <label style="font-size: 12px;"><input type="radio" name="conflict-choice-${i}" value="ours" checked /> Keep Mine</label>
            <label style="font-size: 12px;"><input type="radio" name="conflict-choice-${i}" value="theirs" /> Keep Main</label>
          </div>
        </div>
      `
    }).join('')

    btnCancel.onclick = () => dialog.close()
    btnResolve.onclick = async () => {
      dialog.close()
      try {
        await api.publishDocument(this.projectId, this.docPath, conflict.resolvedContent || this.crepe?.getMarkdown())
        this.showFlash('Conflict resolved and published!', 'success')
        await this.switchMode('read')
      } catch (err: any) {
        this.showFlash(err.message || 'Failed to resolve conflict', 'error')
      }
    }

    dialog.showModal()
  }
}
