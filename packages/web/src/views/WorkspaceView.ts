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
import { i18n } from '../services/i18n'
import { HeaderNav } from '../services/headerNav'

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
  private commentFilter: 'pending' | 'all' = 'all'
  private commentFilterState = {
    type: 'all' as 'all' | 'comments' | 'suggestions',
    authors: [] as string[],
    reviewers: [] as string[],
  }
  private activeThreadId: string | null = null
  private pendingSelection: { start: number; end: number; quote: string } | null = null
  private headerNav: HeaderNav | null = null
  private canvasWidth: 'standard' | 'wide' | 'full' = 'standard'

  constructor(container: HTMLElement, projectSlug: string, initialDocPath?: string) {
    this.container = container
    this.projectSlug = projectSlug
    this.docPath = initialDocPath || ''
    try {
      const savedWidth = localStorage.getItem('md4lp_canvas_width') as 'standard' | 'wide' | 'full'
      if (savedWidth === 'standard' || savedWidth === 'wide' || savedWidth === 'full') {
        this.canvasWidth = savedWidth
      }
    } catch {}
  }

  async render(): Promise<void> {
    const t = i18n.t
    this.headerNav = new HeaderNav(this.container, {
      showBack: true,
      backTitle: t.dashboard.projectsTitle,
      onBack: () => router.navigate('/projects'),
      viewLabel: `
        <span id="headerProjectName" style="font-weight: 700; font-size: 14px; color: var(--text-primary);">...</span>
        <span id="headerDocPath" style="font-size: 12px; color: var(--text-muted); margin-left: 6px;"></span>
      `,
      rightCustomSlot: `
        <button id="btnProjectSettings" class="btn btn-ghost" title="${t.workspace.shareTooltip}" style="font-size: 13px; padding: 4px 8px;">🔗 ${t.workspace.share}</button>
        <button id="btnToggleComments" class="btn btn-ghost" style="font-size: 12px; gap: 4px;">
          💬 <span id="commentsCountBadge" class="badge badge-blue" style="font-size: 10px;">0/0</span>
        </button>
      `,
      flashId: 'workspaceHeaderFlash',
    })

    this.container.innerHTML = `
      <div style="display: flex; height: 100vh; flex-direction: column; background: var(--bg-app);">
        
        <!-- Workspace Navigation Header -->
        ${this.headerNav.render()}

        <!-- Main Split Workspace Layout -->
        <div style="flex: 1; display: flex; min-height: 0;">
          
          <!-- Left Directory Explorer Sidebar -->
          <aside style="width: var(--sidebar-width); background: var(--bg-sidebar); border-right: 1px solid var(--border-subtle); display: flex; flex-direction: column; overflow: hidden;">
            
            <div style="padding: 12px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-subtle);">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted);">${t.workspace.explorer}</span>
              <div style="display: flex; gap: 4px;">
                <button id="btnRefreshTree" class="btn btn-ghost" title="${t.common.refresh}" style="padding: 2px 6px; font-size: 12px;">🔄</button>
                <button id="btnNewDoc" class="btn btn-ghost" title="${t.workspace.newDocumentTooltip}" style="padding: 2px 6px; font-size: 12px;">+📄</button>
              </div>
            </div>

            <!-- New Document Inline Form -->
            <div id="newDocForm" style="display: none; padding: 8px 12px; background: var(--bg-surface); border-bottom: 1px solid var(--border-subtle);">
              <input id="inputNewDocPath" class="input" type="text" placeholder="${t.workspace.newDocPlaceholder}" style="font-size: 12px; padding: 4px 8px; margin-bottom: 6px;" />
              <div style="display: flex; justify-content: flex-end; gap: 4px;">
                <button id="btnCancelNewDoc" class="btn btn-ghost" style="padding: 2px 6px; font-size: 11px;">${t.common.cancel}</button>
                <button id="btnSubmitNewDoc" class="btn btn-primary" style="padding: 2px 8px; font-size: 11px;">${t.common.create}</button>
              </div>
            </div>

            <div id="treeContainer" style="flex: 1; overflow-y: auto; padding: 8px 4px;"></div>
          </aside>

          <!-- Center Content Area -->
          <main id="workspaceMain" class="canvas-width-${this.canvasWidth}" style="flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--bg-surface); position: relative;">
            
            <!-- Floating Mode & Publish Bar (Top Right of Document Pane) -->
            <div id="floatingModeBar" style="position: absolute; top: 16px; right: 24px; z-index: 20; display: flex; align-items: center; gap: 8px; background: var(--bg-surface); padding: 4px; border-radius: var(--radius-md); border: 1px solid var(--border-default); box-shadow: var(--shadow-md); backdrop-filter: blur(8px);">
              <div style="display: flex; background: var(--bg-app); padding: 2px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                <button id="btnModeRead" class="btn btn-ghost" style="padding: 4px 10px; font-size: 12px; border-radius: var(--radius-sm);">${t.workspace.readAndReview}</button>
                <button id="btnModeEdit" class="btn btn-ghost" style="padding: 4px 10px; font-size: 12px; border-radius: var(--radius-sm);">${t.workspace.edit}</button>
              </div>

              <!-- Canvas Width Dropdown (Read & Edit modes) -->
              <div id="canvasWidthWrapper" style="position: relative; display: inline-block;">
                <button id="btnCanvasWidth" class="btn btn-ghost" title="${t.workspace.canvasWidthTooltip}" style="padding: 4px 8px; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
                  <span>↔️</span>
                  <span id="canvasWidthLabel">${this.getCanvasWidthLabel()}</span>
                  <span style="font-size: 10px;">▾</span>
                </button>
                <div id="canvasWidthDropdown" style="display: none; position: absolute; right: 0; top: calc(100% + 4px); background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); padding: 4px; min-width: 170px; z-index: 50; flex-direction: column; gap: 2px;">
                  <button class="btn btn-ghost btn-canvas-width-opt" data-width="standard" style="width: 100%; justify-content: flex-start; font-size: 12px; padding: 6px 10px; border-radius: var(--radius-sm);">
                    <span>📏 ${t.workspace.widthStandard} (900px)</span>
                  </button>
                  <button class="btn btn-ghost btn-canvas-width-opt" data-width="wide" style="width: 100%; justify-content: flex-start; font-size: 12px; padding: 6px 10px; border-radius: var(--radius-sm);">
                    <span>📐 ${t.workspace.widthWide} (1240px)</span>
                  </button>
                  <button class="btn btn-ghost btn-canvas-width-opt" data-width="full" style="width: 100%; justify-content: flex-start; font-size: 12px; padding: 6px 10px; border-radius: var(--radius-sm);">
                    <span>🖥️ ${t.workspace.widthFull} (100%)</span>
                  </button>
                </div>
              </div>

              <!-- Export / Download Dropdown Menu (Read Mode only) -->
              <div id="exportMenuWrapper" style="position: relative; display: inline-block;">
                <button id="btnExportMenu" class="btn btn-ghost" title="${t.workspace.exportTooltip}" style="padding: 4px 8px; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
                  <span>📥 ${t.workspace.export}</span>
                  <span style="font-size: 10px;">▾</span>
                </button>
                <div id="exportDropdownMenu" style="display: none; position: absolute; right: 0; top: calc(100% + 4px); background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); padding: 4px; min-width: 220px; z-index: 50; flex-direction: column; gap: 2px;">
                  <button id="btnExportDownloadMd" class="btn btn-ghost" style="width: 100%; justify-content: flex-start; font-size: 12px; padding: 6px 10px; border-radius: var(--radius-sm);">
                    ${t.workspace.downloadMarkdown}
                  </button>
                  <button id="btnExportDownloadHtml" class="btn btn-ghost" style="width: 100%; justify-content: flex-start; font-size: 12px; padding: 6px 10px; border-radius: var(--radius-sm);">
                    ${t.workspace.exportHtml}
                  </button>
                  <button id="btnExportPrintPdf" class="btn btn-ghost" style="width: 100%; justify-content: flex-start; font-size: 12px; padding: 6px 10px; border-radius: var(--radius-sm);">
                    ${t.workspace.exportPdf}
                  </button>
                </div>
              </div>

              <div id="saveStatusBadge" class="badge badge-blue" style="font-size: 11px; display: none;">${t.workspace.saved}</div>
              <button id="btnPublish" class="btn btn-primary" style="display: none; padding: 4px 12px; font-size: 12px;">
                ${t.workspace.publishToMain}
              </button>
            </div>

            <!-- Read / Render Pane -->
            <div id="readPane" style="flex: 1; overflow-y: auto; padding: 48px 48px 32px; width: 100%; margin: 0 auto; user-select: text;">
              <div id="readContent" class="prose"></div>
            </div>

            <!-- Edit Pane (Crepe WYSIWYG) -->
            <div id="editPane" style="flex: 1; overflow-y: auto; display: none; padding: 48px 32px 24px; width: 100%; margin: 0 auto;">
              <div id="crepeContainer"></div>
            </div>

            <!-- Floating Selection Popover for Comments -->
            <div id="selectionPopover" style="display: none; position: absolute; z-index: 100; background: var(--bg-surface); border: 1px solid var(--border-default); box-shadow: var(--shadow-lg); border-radius: var(--radius-md); padding: 4px; gap: 4px;">
              <button id="btnPopAddComment" class="btn btn-ghost" style="font-size: 12px; padding: 4px 8px;">💬 ${t.workspace.addComment}</button>
            </div>

          </main>

          <!-- Right Comments & Suggestions Drawer -->
          <aside id="commentsDrawer" style="width: var(--drawer-width); background: var(--bg-surface); border-left: 1px solid var(--border-subtle); display: flex; flex-direction: column; overflow: hidden;">
            <div style="padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary);">${t.workspace.commentsAndSuggestions}</h3>
                <button id="btnCloseDrawer" class="btn btn-ghost" style="padding: 2px 6px; font-size: 12px;">✕</button>
              </div>

              <!-- Filter Toggle & Advanced Filter Button -->
              <div style="display: flex; gap: 6px; align-items: center;">
                <div style="display: flex; flex-1; background: var(--bg-app); padding: 2px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); font-size: 11px;">
                  <button id="btnFilterPending" class="btn btn-ghost" style="flex: 1; padding: 2px 6px; font-size: 11px; border-radius: var(--radius-sm);">${t.workspace.pendingOnly}</button>
                  <button id="btnFilterAll" class="btn btn-ghost" style="flex: 1; padding: 2px 6px; font-size: 11px; border-radius: var(--radius-sm);">${t.workspace.allTab}</button>
                </div>
                <button id="btnOpenCommentsFilter" class="btn btn-ghost" title="${t.workspace.filters}" style="padding: 3px 8px; font-size: 11px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); display: flex; align-items: center; gap: 4px; white-space: nowrap;">
                  <span>${t.workspace.filters}</span>
                  <span id="activeFilterBadge" style="display: none; width: 6px; height: 6px; border-radius: 50%; background: var(--accent-primary);"></span>
                </button>
              </div>
            </div>

            <!-- New Comment Box (when text is selected) -->
            <div id="newCommentBox" style="display: none; padding: 12px; background: var(--bg-app); border-bottom: 1px solid var(--border-subtle);">
              <div id="commentSelectedQuote" style="font-size: 11px; font-style: italic; color: var(--text-muted); margin-bottom: 6px; border-left: 2px solid var(--accent-primary); padding-left: 6px; max-height: 40px; overflow: hidden; text-overflow: ellipsis;"></div>
              
              <textarea id="inputCommentBody" class="input" rows="2" placeholder="${t.workspace.leaveReviewCommentPlaceholder}" style="resize: vertical; margin-bottom: 6px;"></textarea>
              
              <div style="margin-bottom: 8px;">
                <input id="inputSuggestionText" class="input" type="text" placeholder="${t.workspace.optionalReplacementPlaceholder}" style="font-size: 11px;" />
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 6px;">
                <button id="btnCancelNewComment" class="btn btn-ghost" style="font-size: 11px; padding: 3px 8px;">${t.common.cancel}</button>
                <button id="btnSubmitNewComment" class="btn btn-primary" style="font-size: 11px; padding: 3px 10px;">${t.workspace.post}</button>
              </div>
            </div>

            <!-- Comments List -->
            <div id="commentsListContainer" style="flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px;"></div>
          </aside>

        </div>
      </div>

      <!-- Advanced Comments Filter Modal -->
      <dialog id="commentsFilterModal" style="max-width: 440px; width: 90%; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--bg-surface); color: var(--text-primary); padding: 20px; box-shadow: var(--shadow-lg);">
        <h3 style="margin: 0 0 16px; font-size: 15px; font-weight: 700;">${t.workspace.commentsAndSuggestions}</h3>
        
        <div style="display: flex; flex-direction: column; gap: 16px; margin-bottom: 20px;">
          <!-- Content Type Segmented Toggle -->
          <div>
            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: var(--text-secondary);">${t.workspace.contentType}</label>
            <div id="modalFilterTypeToggle" style="display: flex; background: var(--bg-app); padding: 2px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); gap: 2px;">
              <button type="button" class="btn btn-primary btn-modal-filter-type" data-type="all" style="flex: 1; padding: 4px 6px; font-size: 11px; border-radius: var(--radius-sm);">${t.workspace.allTab}</button>
              <button type="button" class="btn btn-ghost btn-modal-filter-type" data-type="comments" style="flex: 1; padding: 4px 6px; font-size: 11px; border-radius: var(--radius-sm);">${t.workspace.commentsOnly}</button>
              <button type="button" class="btn btn-ghost btn-modal-filter-type" data-type="suggestions" style="flex: 1; padding: 4px 6px; font-size: 11px; border-radius: var(--radius-sm);">${t.workspace.suggestionsOnly}</button>
            </div>
          </div>

          <!-- Multi-Select Authors (Thread Creators) -->
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">${t.workspace.threadCreator}</label>
              <span style="font-size: 10px; color: var(--text-muted);">${t.workspace.multiSelectHint}</span>
            </div>
            <div id="filterAuthorsList" style="display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto; padding: 6px; background: var(--bg-app); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);"></div>
          </div>

          <!-- Multi-Select Reviewers / Participants -->
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">${t.workspace.participantReviewer}</label>
              <span style="font-size: 10px; color: var(--text-muted);">${t.workspace.multiSelectHint}</span>
            </div>
            <div id="filterReviewersList" style="display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto; padding: 6px; background: var(--bg-app); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);"></div>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
          <button id="btnClearCommentsFilter" class="btn btn-ghost" style="font-size: 12px; color: var(--danger-text);">${t.workspace.clearFilters}</button>
          <div style="display: flex; gap: 8px;">
            <button id="btnCancelCommentsFilter" class="btn btn-ghost" style="font-size: 12px;">${t.common.cancel}</button>
            <button id="btnApplyCommentsFilter" class="btn btn-primary" style="font-size: 12px;">${t.workspace.applyFilters}</button>
          </div>
        </div>
      </dialog>

      <!-- Rename Document Dialog -->
      <dialog id="renameDocDialog" style="max-width: 440px; width: 90%; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--bg-surface); color: var(--text-primary); padding: 24px; box-shadow: var(--shadow-lg);">
        <h3 style="margin: 0 0 8px; font-size: 16px; font-weight: 700;">${t.workspace.renameDocTitle}</h3>
        <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 16px; line-height: 1.4;">
          ${t.workspace.renameDocDesc}
        </p>
        <div style="margin-bottom: 16px;">
          <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px;">${t.workspace.newPathLabel}</label>
          <input id="inputRenameDocPath" class="input" type="text" placeholder="${t.workspace.newPathPlaceholder}" style="font-size: 13px;" />
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button id="btnCancelRenameDoc" class="btn btn-ghost" style="font-size: 12px;">${t.common.cancel}</button>
          <button id="btnConfirmRenameDoc" class="btn btn-primary" style="font-size: 12px;">${t.workspace.renameDocButton}</button>
        </div>
      </dialog>

      <!-- Delete Document Confirmation Dialog -->
      <dialog id="deleteDocDialog" style="max-width: 440px; width: 90%; border: 1px solid var(--danger-border); border-radius: var(--radius-lg); background: var(--bg-surface); color: var(--text-primary); padding: 24px; box-shadow: var(--shadow-lg);">
        <h3 style="margin: 0 0 8px; font-size: 16px; font-weight: 700; color: var(--danger-text);">${t.workspace.deleteDocTitle}</h3>
        <p style="font-size: 13px; color: var(--text-secondary); margin: 0 0 16px; line-height: 1.4;">
          ${t.workspace.deleteDocDesc} (<b id="deleteDocTargetName"></b>)
        </p>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button id="btnCancelDeleteDoc" class="btn btn-ghost" style="font-size: 12px;">${t.common.cancel}</button>
          <button id="btnConfirmDeleteDoc" class="btn btn-danger" style="font-size: 12px;">${t.common.delete}</button>
        </div>
      </dialog>

      <!-- 3-Way Merge Conflict Resolution Dialog -->
      <dialog id="conflictDialog" style="max-width: 750px; width: 90%; border: 1px solid var(--border-default); border-radius: var(--radius-lg); background: var(--bg-surface); color: var(--text-primary); padding: 24px; box-shadow: var(--shadow-lg);">
        <h3 style="margin-top: 0; color: var(--danger-text); font-size: 16px;">${t.workspace.conflictDetectedTitle}</h3>
        <p style="font-size: 13px; color: var(--text-secondary);">
          ${t.workspace.conflictDetectedDesc}
        </p>

        <div id="conflictBlocksContainer" style="max-height: 380px; overflow-y: auto; margin: 16px 0; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 12px; background: var(--bg-app); display: flex; flex-direction: column; gap: 12px;"></div>

        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button id="btnCancelConflict" class="btn btn-ghost">${t.common.cancel}</button>
          <button id="btnResolveAndPublish" class="btn btn-primary">${t.workspace.applyResolutionAndPublish}</button>
        </div>
      </dialog>
    `

    this.bindEvents()
    await this.initWorkspace()
  }

  private async initWorkspace(): Promise<void> {
    try {
      const [meRes, projsRes] = await Promise.all([
        api.getMe().catch(() => ({ user: null })),
        api.listProjects(),
      ])

      if (this.headerNav && meRes.user) {
        this.headerNav.setUser(meRes.user, 0)
      }

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
      this.setupTreePolling()
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

  private treePollTimer: any = null

  private setupTreePolling(): void {
    if (this.treePollTimer) clearInterval(this.treePollTimer)
    // Poll every 5 seconds for background changes (agents, git commits)
    this.treePollTimer = setInterval(() => {
      this.refreshTree()
    }, 5000)

    const onFocus = () => this.refreshTree()
    window.addEventListener('focus', onFocus)
  }

  private isRefreshingTree = false
  private async refreshTree(): Promise<void> {
    if (!this.projectId || this.isRefreshingTree) return
    this.isRefreshingTree = true
    try {
      const res = await api.listTree(this.projectId)
      const newTree = res.tree || []
      if (JSON.stringify(newTree) !== JSON.stringify(this.tree)) {
        this.tree = newTree
        this.renderTree()
      }
    } catch {} finally {
      this.isRefreshingTree = false
    }
  }

  private buildTreeHtml(items: DocumentTreeItem[], depth = 0): string {
    return items.map((it) => {
      const paddingLeft = 8 + depth * 12
      const isSelected = it.path === this.docPath

      if (it.type === 'directory') {
        return `
          <div class="tree-dir" draggable="true" data-path="${it.path}" data-type="directory" style="margin-bottom: 2px;">
            <div class="tree-dir-header" style="padding: 4px 6px 4px ${paddingLeft}px; font-size: 12px; font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; cursor: pointer; border-radius: var(--radius-sm); user-select: none;">
              <span>📁</span> <span>${it.name}</span>
            </div>
            <div>${it.children ? this.buildTreeHtml(it.children, depth + 1) : ''}</div>
          </div>
        `
      }

      return `
        <div class="tree-file" draggable="true" data-path="${it.path}" data-type="file" style="padding: 4px 6px 4px ${paddingLeft}px; font-size: 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; border-radius: var(--radius-sm); margin-bottom: 1px; color: ${isSelected ? 'var(--accent-primary)' : 'var(--text-primary)'}; background: ${isSelected ? 'var(--accent-subtle)' : 'transparent'}; font-weight: ${isSelected ? '600' : '400'}; user-select: none;">
          <div style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;">
            <span>📄</span>
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${it.name}</span>
          </div>
          <div class="tree-file-actions" style="display: flex; gap: 2px; opacity: ${isSelected ? '1' : '0.6'};">
            <button class="btn btn-ghost btn-tree-rename" data-path="${it.path}" title="Rename / Move" style="padding: 1px 4px; font-size: 11px; line-height: 1;">✏️</button>
            <button class="btn btn-ghost btn-tree-delete" data-path="${it.path}" title="Delete" style="padding: 1px 4px; font-size: 11px; line-height: 1; color: var(--danger-text);">🗑️</button>
          </div>
        </div>
      `
    }).join('')
  }

  private computeDroppedPath(sourcePath: string, targetPath: string, targetType: 'file' | 'directory' | 'root'): string {
    const fileName = sourcePath.includes('/') ? sourcePath.substring(sourcePath.lastIndexOf('/') + 1) : sourcePath
    if (targetType === 'root') {
      return fileName
    }
    if (targetType === 'directory') {
      return targetPath ? `${targetPath}/${fileName}` : fileName
    }
    const parentDir = targetPath.includes('/') ? targetPath.substring(0, targetPath.lastIndexOf('/')) : ''
    return parentDir ? `${parentDir}/${fileName}` : fileName
  }

  private pendingActionDocPath: string | null = null
  private draggedTreePath: string | null = null

  private renderTree(): void {
    const container = this.container.querySelector<HTMLElement>('#treeContainer')!
    if (this.tree.length === 0) {
      container.innerHTML = `<div style="padding: 12px; font-size: 12px; color: var(--text-muted); text-align: center;">No documents yet.</div>`
      return
    }

    container.innerHTML = this.buildTreeHtml(this.tree)

    container.querySelectorAll<HTMLElement>('.tree-file').forEach((el) => {
      el.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement
        if (target.closest('.tree-file-actions')) return // ignore clicks on action buttons
        const path = el.getAttribute('data-path')
        if (path && path !== this.docPath) {
          await this.openDocument(path)
        }
      })
    })

    // Drag & Drop on individual files (cannot receive drops)
    const treeFiles = container.querySelectorAll<HTMLElement>('.tree-file')
    treeFiles.forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        e.stopPropagation()
        const path = el.getAttribute('data-path')
        if (path) {
          this.draggedTreePath = path
          if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', path)
            e.dataTransfer.effectAllowed = 'move'
          }
          el.style.opacity = '0.5'
        }
      })

      el.addEventListener('dragend', () => {
        el.style.opacity = '1'
        this.draggedTreePath = null
      })

      // Dropping over a file is NOT permitted
      el.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'none'
        }
      })
    })

    // Drag & Drop on directories (can receive drops)
    const treeDirs = container.querySelectorAll<HTMLElement>('.tree-dir')
    treeDirs.forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        e.stopPropagation()
        const path = el.getAttribute('data-path')
        if (path) {
          this.draggedTreePath = path
          if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', path)
            e.dataTransfer.effectAllowed = 'move'
          }
          el.style.opacity = '0.5'
        }
      })

      el.addEventListener('dragend', () => {
        el.style.opacity = '1'
        this.draggedTreePath = null
      })

      el.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move'
        }
        el.style.outline = '2px dashed var(--accent-primary)'
      })

      el.addEventListener('dragleave', (e) => {
        e.stopPropagation()
        el.style.outline = 'none'
      })

      el.addEventListener('drop', (e) => {
        e.preventDefault()
        e.stopPropagation()
        el.style.outline = 'none'

        const srcPath = e.dataTransfer?.getData('text/plain') || this.draggedTreePath
        const targetPath = el.getAttribute('data-path')

        if (!srcPath || !targetPath || srcPath === targetPath || targetPath.startsWith(srcPath + '/')) return

        const suggestedPath = this.computeDroppedPath(srcPath, targetPath, 'directory')
        if (suggestedPath !== srcPath) {
          this.openRenameDialog(srcPath, suggestedPath)
        }
      })
    })

    // Drag & Drop on root tree container
    container.addEventListener('dragover', (e) => {
      e.preventDefault()
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move'
      }
    })

    container.addEventListener('drop', (e) => {
      const target = e.target as HTMLElement
      if (target === container) {
        e.preventDefault()
        const srcPath = e.dataTransfer?.getData('text/plain') || this.draggedTreePath
        if (srcPath) {
          const suggestedPath = this.computeDroppedPath(srcPath, '', 'root')
          if (suggestedPath !== srcPath) {
            this.openRenameDialog(srcPath, suggestedPath)
          }
        }
      }
    })

    // Bind Rename Buttons
    container.querySelectorAll<HTMLButtonElement>('.btn-tree-rename').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const path = btn.getAttribute('data-path')!
        this.openRenameDialog(path)
      })
    })

    // Bind Delete Buttons
    container.querySelectorAll<HTMLButtonElement>('.btn-tree-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const path = btn.getAttribute('data-path')!
        this.openDeleteDialog(path)
      })
    })
  }

  private openRenameDialog(path: string, suggestedPath?: string): void {
    const dialog = this.container.querySelector<HTMLDialogElement>('#renameDocDialog')!
    const input = this.container.querySelector<HTMLInputElement>('#inputRenameDocPath')!
    this.pendingActionDocPath = path
    input.value = suggestedPath ?? path
    dialog.showModal()
    input.focus()
  }

  private openDeleteDialog(path: string): void {
    const dialog = this.container.querySelector<HTMLDialogElement>('#deleteDocDialog')!
    const nameEl = this.container.querySelector<HTMLElement>('#deleteDocTargetName')!
    this.pendingActionDocPath = path
    nameEl.textContent = path
    dialog.showModal()
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

    const exportWrapper = this.container.querySelector<HTMLElement>('#exportMenuWrapper')
    if (exportWrapper) exportWrapper.style.display = 'inline-block'

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

    // Enhance tables and code blocks with breakout containers & action bars
    this.enhanceBreakoutElements()

    // Highlight comments in Read Mode
    this.applyCommentHighlights()
  }

  private getCanvasWidthLabel(): string {
    const t = i18n.t.workspace
    if (this.canvasWidth === 'wide') return t.widthWide
    if (this.canvasWidth === 'full') return t.widthFull
    return t.widthStandard
  }

  private setCanvasWidth(width: 'standard' | 'wide' | 'full'): void {
    this.canvasWidth = width
    try {
      localStorage.setItem('md4lp_canvas_width', width)
    } catch {}

    const workspaceMain = this.container.querySelector<HTMLElement>('#workspaceMain')
    if (workspaceMain) {
      workspaceMain.classList.remove('canvas-width-standard', 'canvas-width-wide', 'canvas-width-full')
      workspaceMain.classList.add(`canvas-width-${width}`)
    }

    const label = this.container.querySelector<HTMLElement>('#canvasWidthLabel')
    if (label) {
      label.textContent = this.getCanvasWidthLabel()
    }
  }

  private enhanceBreakoutElements(): void {
    const readContent = this.container.querySelector<HTMLElement>('#readContent')
    if (!readContent) return

    // 1. Wrap Tables with Breakout Container & Toolbar
    const tables = readContent.querySelectorAll('table')
    tables.forEach((table) => {
      if (table.closest('.breakout-wrapper')) return
      const wrapper = document.createElement('div')
      wrapper.className = 'breakout-wrapper table-breakout-wrapper'

      const header = document.createElement('div')
      header.className = 'breakout-header'
      header.innerHTML = `
        <div class="breakout-header-title">
          <span>📊</span>
          <span>${i18n.t.workspace.table}</span>
        </div>
        <div class="breakout-actions">
          <button type="button" class="btn btn-ghost btn-toggle-breakout" title="${i18n.t.workspace.toggleBreakoutTooltip}" style="font-size: 11px; padding: 2px 6px;">
            <span>↔️</span> <span class="breakout-btn-text">${i18n.t.workspace.expandWidth}</span>
          </button>
        </div>
      `
      const body = document.createElement('div')
      body.className = 'breakout-body'

      table.parentNode?.insertBefore(wrapper, table)
      body.appendChild(table)
      wrapper.appendChild(header)
      wrapper.appendChild(body)

      const btnToggle = header.querySelector<HTMLButtonElement>('.btn-toggle-breakout')!
      const btnText = header.querySelector<HTMLElement>('.breakout-btn-text')!
      btnToggle.addEventListener('click', (e) => {
        e.stopPropagation()
        const isExpanded = wrapper.classList.toggle('is-breakout')
        btnText.textContent = isExpanded ? i18n.t.workspace.collapseWidth : i18n.t.workspace.expandWidth
      })
    })

    // 2. Wrap Code Blocks (pre) with Breakout Container, Language Badge & Copy Button
    const pres = readContent.querySelectorAll('pre')
    pres.forEach((pre) => {
      if (pre.closest('.breakout-wrapper')) return
      const code = pre.querySelector('code')
      let lang = 'CODE'
      if (code) {
        for (const cls of Array.from(code.classList)) {
          if (cls.startsWith('language-')) {
            lang = cls.replace('language-', '').toUpperCase()
            break
          }
        }
      }
      const wrapper = document.createElement('div')
      wrapper.className = 'breakout-wrapper code-breakout-wrapper'

      const header = document.createElement('div')
      header.className = 'breakout-header'
      header.innerHTML = `
        <div class="breakout-header-title">
          <span class="badge badge-blue" style="font-size: 9px; padding: 1px 6px;">${lang}</span>
        </div>
        <div class="breakout-actions">
          <button type="button" class="btn btn-ghost btn-copy-code" title="${i18n.t.common.copy}" style="font-size: 11px; padding: 2px 6px;">
            <span>📋</span> <span class="copy-btn-text">${i18n.t.common.copy}</span>
          </button>
          <button type="button" class="btn btn-ghost btn-toggle-breakout" title="${i18n.t.workspace.toggleBreakoutTooltip}" style="font-size: 11px; padding: 2px 6px;">
            <span>↔️</span> <span class="breakout-btn-text">${i18n.t.workspace.expandWidth}</span>
          </button>
        </div>
      `
      const body = document.createElement('div')
      body.className = 'breakout-body'

      pre.parentNode?.insertBefore(wrapper, pre)
      body.appendChild(pre)
      wrapper.appendChild(header)
      wrapper.appendChild(body)

      const btnToggle = header.querySelector<HTMLButtonElement>('.btn-toggle-breakout')!
      const btnText = header.querySelector<HTMLElement>('.breakout-btn-text')!
      btnToggle.addEventListener('click', (e) => {
        e.stopPropagation()
        const isExpanded = wrapper.classList.toggle('is-breakout')
        btnText.textContent = isExpanded ? i18n.t.workspace.collapseWidth : i18n.t.workspace.expandWidth
      })

      const btnCopy = header.querySelector<HTMLButtonElement>('.btn-copy-code')!
      const copyText = header.querySelector<HTMLElement>('.copy-btn-text')!
      btnCopy.addEventListener('click', async (e) => {
        e.stopPropagation()
        const text = code ? code.textContent || '' : pre.textContent || ''
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text)
          }
          copyText.textContent = i18n.t.workspace.codeCopied
          setTimeout(() => {
            copyText.textContent = i18n.t.common.copy
          }, 2000)
        } catch {}
      })
    })
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

    const exportWrapper = this.container.querySelector<HTMLElement>('#exportMenuWrapper')
    if (exportWrapper) exportWrapper.style.display = 'none'

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
      const pendingCount = this.comments.filter((sc) => sc.comment.status !== 'resolved').length
      const totalCount = this.comments.length
      const countEl = this.container.querySelector<HTMLElement>('#commentsCountBadge')!
      countEl.textContent = `${pendingCount}/${totalCount}`
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

  private hasActiveAdvancedFilters(): boolean {
    return (
      this.commentFilterState.type !== 'all' ||
      this.commentFilterState.authors.length > 0 ||
      this.commentFilterState.reviewers.length > 0
    )
  }

  private getFilterTooltip(): string {
    if (!this.hasActiveAdvancedFilters()) {
      return 'Filters: None active (Click to configure)'
    }

    const parts: string[] = ['Active filters:']
    if (this.commentFilterState.type !== 'all') {
      const typeLabel = this.commentFilterState.type === 'comments' ? 'Comments only' : 'Suggestions only'
      parts.push(`• Type: ${typeLabel}`)
    }
    if (this.commentFilterState.authors.length > 0) {
      parts.push(`• Authors: ${this.commentFilterState.authors.join(', ')}`)
    }
    if (this.commentFilterState.reviewers.length > 0) {
      parts.push(`• Participants: ${this.commentFilterState.reviewers.join(', ')}`)
    }

    return parts.join('\n')
  }

  private renderCommentsDrawer(): void {
    const list = this.container.querySelector<HTMLElement>('#commentsListContainer')!

    // Update filter toggle buttons appearance
    const btnPending = this.container.querySelector<HTMLButtonElement>('#btnFilterPending')
    const btnAll = this.container.querySelector<HTMLButtonElement>('#btnFilterAll')
    if (btnPending && btnAll) {
      if (this.commentFilter === 'pending') {
        btnPending.classList.add('btn-primary')
        btnPending.classList.remove('btn-ghost')
        btnAll.classList.add('btn-ghost')
        btnAll.classList.remove('btn-primary')
      } else {
        btnAll.classList.add('btn-primary')
        btnAll.classList.remove('btn-ghost')
        btnPending.classList.add('btn-ghost')
        btnPending.classList.remove('btn-primary')
      }
    }

    // Update advanced filter button appearance, badge & tooltip
    const btnFilter = this.container.querySelector<HTMLButtonElement>('#btnOpenCommentsFilter')
    const activeBadge = this.container.querySelector<HTMLElement>('#activeFilterBadge')
    const hasAdvanced = this.hasActiveAdvancedFilters()
    if (btnFilter) {
      btnFilter.title = this.getFilterTooltip()
      if (hasAdvanced) {
        btnFilter.style.background = 'var(--accent-subtle)'
        btnFilter.style.color = 'var(--accent-primary)'
        btnFilter.style.borderColor = 'var(--accent-primary)'
      } else {
        btnFilter.style.background = 'transparent'
        btnFilter.style.color = 'var(--text-secondary)'
        btnFilter.style.borderColor = 'var(--border-subtle)'
      }
    }
    if (activeBadge) {
      activeBadge.style.display = hasAdvanced ? 'inline-block' : 'none'
    }

    const displayedComments = this.comments.filter((sc) => {
      const c = sc.comment

      // 1. Pending vs All
      if (this.commentFilter === 'pending' && c.status === 'resolved') {
        return false
      }

      // 2. Content Type Segmented Toggle (All, Comments, Suggestions)
      if (this.commentFilterState.type === 'comments' && c.suggestion) {
        return false
      }
      if (this.commentFilterState.type === 'suggestions' && !c.suggestion) {
        return false
      }

      // 3. Multi-Select Author Filter (Thread Creator)
      if (this.commentFilterState.authors.length > 0) {
        const creator = c.author || sc.owner
        if (!this.commentFilterState.authors.includes(creator)) {
          return false
        }
      }

      // 4. Multi-Select Reviewer / Participant Filter (Thread Creator or Reply Author)
      if (this.commentFilterState.reviewers.length > 0) {
        const creator = c.author || sc.owner
        const hasCreator = this.commentFilterState.reviewers.includes(creator)
        const hasReplied = c.replies?.some((r: any) => this.commentFilterState.reviewers.includes(r.author))
        if (!hasCreator && !hasReplied) {
          return false
        }
      }

      return true
    })

    if (displayedComments.length === 0) {
      const msg = this.commentFilter === 'pending'
        ? (this.comments.length > 0 ? 'No pending comments or suggestions match your filters.' : 'No comments yet on this document.')
        : 'No comments match the selected filters.'
      list.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 12px;">${msg}</div>`
      return
    }

    const t = i18n.t
    list.innerHTML = displayedComments.map((sc) => {
      const c = sc.comment
      const isResolved = c.status === 'resolved'

      return `
        <div class="comment-thread-card" data-id="${c.id}" style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 12px; box-shadow: var(--shadow-sm); opacity: ${isResolved ? '0.6' : '1'};">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
            <div>
              <span style="font-weight: 600; font-size: 12px; color: var(--text-primary);">${c.author || t.common.user}</span>
            </div>
            ${isResolved ? `<span class="badge badge-green" style="font-size: 9px;">${t.workspace.resolved}</span>` : ''}
          </div>

          <div style="font-size: 13px; color: var(--text-primary); margin-bottom: 8px; line-height: 1.4;">${renderComment(c.body)}</div>

          ${c.suggestion ? `
            <div style="background: var(--accent-subtle); border-left: 2px solid var(--accent-primary); border-radius: var(--radius-sm); padding: 6px 8px; margin-bottom: 8px; font-size: 11px;">
              <div style="font-weight: 600; color: var(--accent-primary); margin-bottom: 2px;">${t.workspace.suggestedReplacement}</div>
              <pre style="margin: 0; font-family: var(--font-mono); white-space: pre-wrap;">${c.suggestion}</pre>
            </div>
            ${!isResolved ? `
              <div style="display: flex; gap: 6px; justify-content: flex-end; margin-bottom: 8px;">
                <button class="btn btn-ghost btn-reject-sugg" data-owner="${sc.owner}" data-id="${c.id}" style="font-size: 11px; padding: 2px 6px;">${t.workspace.rejectSuggestion}</button>
                <button class="btn btn-primary btn-apply-sugg" data-owner="${sc.owner}" data-id="${c.id}" style="font-size: 11px; padding: 2px 8px;">${t.workspace.applySuggestion}</button>
              </div>
            ` : ''}
          ` : ''}

          <!-- Replies List -->
          ${c.replies && c.replies.length > 0 ? `
            <div style="display: flex; flex-direction: column; gap: 6px; margin: 8px 0; padding-left: 10px; border-left: 1px solid var(--border-subtle);">
              ${c.replies.map((r: any) => `
                <div style="font-size: 11px;">
                  <b>${r.author || t.common.user}:</b> ${r.body}
                </div>
              `).join('')}
            </div>
          ` : ''}

          <!-- Reply Box Trigger -->
          ${!isResolved ? `
            <div style="display: flex; gap: 4px; margin-top: 6px;">
              <input class="input input-reply" type="text" placeholder="${t.workspace.replyPlaceholder}" style="font-size: 11px; padding: 3px 6px;" />
              <button class="btn btn-ghost btn-send-reply" data-owner="${sc.owner}" data-id="${c.id}" style="font-size: 11px; padding: 2px 6px;">${t.workspace.reply}</button>
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
          } else if (data.type === 'doc') {
            await this.refreshTree()
            if (data.file === this.docPath && this.mode === 'read') {
              const res = await api.getDocument(this.projectId, this.docPath)
              this.currentDoc = res
              this.renderReadMode()
            }
          } else if (data.type === 'tree') {
            await this.refreshTree()
          }
        } catch {}
      }
    } catch {}
  }

  private bindEvents(): void {
    if (this.headerNav) {
      this.headerNav.bindEvents(() => {
        this.render()
      })
    }

    const btnRead = this.container.querySelector<HTMLButtonElement>('#btnModeRead')!
    const btnEdit = this.container.querySelector<HTMLButtonElement>('#btnModeEdit')!
    const btnSettings = this.container.querySelector<HTMLButtonElement>('#btnProjectSettings')!
    const btnPublish = this.container.querySelector<HTMLButtonElement>('#btnPublish')!

    const btnRefreshTree = this.container.querySelector<HTMLButtonElement>('#btnRefreshTree')
    if (btnRefreshTree) {
      btnRefreshTree.addEventListener('click', async () => {
        btnRefreshTree.style.transform = 'rotate(180deg)'
        btnRefreshTree.style.transition = 'transform 0.3s ease'
        await this.refreshTree()
        setTimeout(() => {
          btnRefreshTree.style.transform = 'none'
          btnRefreshTree.style.transition = 'none'
        }, 300)
      })
    }

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

    btnSettings.addEventListener('click', () => router.navigate(`/p/${this.projectSlug}/settings`))

    btnRead.addEventListener('click', () => this.switchMode('read'))
    btnEdit.addEventListener('click', () => this.switchMode('edit'))

    // Canvas Width Dropdown Bindings
    const btnCanvasWidth = this.container.querySelector<HTMLButtonElement>('#btnCanvasWidth')
    const canvasWidthDropdown = this.container.querySelector<HTMLElement>('#canvasWidthDropdown')
    const widthOptions = this.container.querySelectorAll<HTMLButtonElement>('.btn-canvas-width-opt')

    if (btnCanvasWidth && canvasWidthDropdown) {
      btnCanvasWidth.addEventListener('click', (e) => {
        e.stopPropagation()
        const isHidden = canvasWidthDropdown.style.display === 'none' || !canvasWidthDropdown.style.display
        canvasWidthDropdown.style.display = isHidden ? 'flex' : 'none'
      })

      document.addEventListener('click', (e) => {
        if (!canvasWidthDropdown.contains(e.target as Node) && e.target !== btnCanvasWidth) {
          canvasWidthDropdown.style.display = 'none'
        }
      })
    }

    widthOptions.forEach((opt) => {
      opt.addEventListener('click', () => {
        const width = opt.getAttribute('data-width') as 'standard' | 'wide' | 'full'
        if (width) {
          this.setCanvasWidth(width)
          if (canvasWidthDropdown) canvasWidthDropdown.style.display = 'none'
        }
      })
    })

    // Export Dropdown Menu Bindings
    const btnExportMenu = this.container.querySelector<HTMLButtonElement>('#btnExportMenu')
    const exportDropdown = this.container.querySelector<HTMLElement>('#exportDropdownMenu')
    const btnDownloadMd = this.container.querySelector<HTMLButtonElement>('#btnExportDownloadMd')
    const btnDownloadHtml = this.container.querySelector<HTMLButtonElement>('#btnExportDownloadHtml')
    const btnPrintPdf = this.container.querySelector<HTMLButtonElement>('#btnExportPrintPdf')

    if (btnExportMenu && exportDropdown) {
      btnExportMenu.addEventListener('click', (e) => {
        e.stopPropagation()
        const isHidden = exportDropdown.style.display === 'none' || !exportDropdown.style.display
        exportDropdown.style.display = isHidden ? 'flex' : 'none'
      })

      document.addEventListener('click', (e) => {
        if (!exportDropdown.contains(e.target as Node) && e.target !== btnExportMenu) {
          exportDropdown.style.display = 'none'
        }
      })
    }

    if (btnDownloadMd) {
      btnDownloadMd.addEventListener('click', () => {
        if (exportDropdown) exportDropdown.style.display = 'none'
        this.downloadMarkdownFile()
      })
    }

    if (btnDownloadHtml) {
      btnDownloadHtml.addEventListener('click', () => {
        if (exportDropdown) exportDropdown.style.display = 'none'
        this.exportStandaloneHtml()
      })
    }

    if (btnPrintPdf) {
      btnPrintPdf.addEventListener('click', () => {
        if (exportDropdown) exportDropdown.style.display = 'none'
        this.exportPrintPdf()
      })
    }

    btnToggleComments.addEventListener('click', () => {
      drawer.style.display = drawer.style.display === 'none' ? 'flex' : 'none'
    })
    btnCloseDrawer.addEventListener('click', () => {
      drawer.style.display = 'none'
    })

    const btnFilterPending = this.container.querySelector<HTMLButtonElement>('#btnFilterPending')!
    const btnFilterAll = this.container.querySelector<HTMLButtonElement>('#btnFilterAll')!
    btnFilterPending.addEventListener('click', () => {
      this.commentFilter = 'pending'
      this.renderCommentsDrawer()
    })
    btnFilterAll.addEventListener('click', () => {
      this.commentFilter = 'all'
      this.renderCommentsDrawer()
    })

    // Advanced Comments Filter Modal Bindings
    const filterModal = this.container.querySelector<HTMLDialogElement>('#commentsFilterModal')!
    const btnOpenFilter = this.container.querySelector<HTMLButtonElement>('#btnOpenCommentsFilter')!
    const btnCancelFilter = this.container.querySelector<HTMLButtonElement>('#btnCancelCommentsFilter')!
    const btnClearFilter = this.container.querySelector<HTMLButtonElement>('#btnClearCommentsFilter')!
    const btnApplyFilter = this.container.querySelector<HTMLButtonElement>('#btnApplyCommentsFilter')!

    const authorsListContainer = this.container.querySelector<HTMLElement>('#filterAuthorsList')!
    const reviewersListContainer = this.container.querySelector<HTMLElement>('#filterReviewersList')!
    const modalTypeButtons = this.container.querySelectorAll<HTMLButtonElement>('.btn-modal-filter-type')

    let currentModalType: 'all' | 'comments' | 'suggestions' = this.commentFilterState.type

    const updateModalTypeButtons = (selected: 'all' | 'comments' | 'suggestions') => {
      currentModalType = selected
      modalTypeButtons.forEach((btn) => {
        const type = btn.getAttribute('data-type')
        if (type === selected) {
          btn.classList.add('btn-primary')
          btn.classList.remove('btn-ghost')
        } else {
          btn.classList.add('btn-ghost')
          btn.classList.remove('btn-primary')
        }
      })
    }

    modalTypeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = (btn.getAttribute('data-type') || 'all') as 'all' | 'comments' | 'suggestions'
        updateModalTypeButtons(type)
      })
    })

    btnOpenFilter.addEventListener('click', () => {
      currentModalType = this.commentFilterState.type
      updateModalTypeButtons(currentModalType)

      const authors = new Set<string>()
      const reviewers = new Set<string>()

      for (const sc of this.comments) {
        const creator = sc.comment.author || sc.owner
        if (creator) {
          authors.add(creator)
          reviewers.add(creator)
        }
        if (sc.comment.replies) {
          for (const r of sc.comment.replies) {
            if (r.author) reviewers.add(r.author)
          }
        }
      }

      if (authors.size === 0) {
        authorsListContainer.innerHTML = `<div style="font-size: 11px; color: var(--text-muted); padding: 4px;">No authors found</div>`
      } else {
        authorsListContainer.innerHTML = Array.from(authors)
          .map((a) => {
            const isChecked = this.commentFilterState.authors.includes(a)
            return `
              <label style="display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; user-select: none;">
                <input type="checkbox" class="chk-filter-author" value="${a}" ${isChecked ? 'checked' : ''} />
                <span>${a}</span>
              </label>
            `
          })
          .join('')
      }

      if (reviewers.size === 0) {
        reviewersListContainer.innerHTML = `<div style="font-size: 11px; color: var(--text-muted); padding: 4px;">No participants found</div>`
      } else {
        reviewersListContainer.innerHTML = Array.from(reviewers)
          .map((r) => {
            const isChecked = this.commentFilterState.reviewers.includes(r)
            return `
              <label style="display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; user-select: none;">
                <input type="checkbox" class="chk-filter-reviewer" value="${r}" ${isChecked ? 'checked' : ''} />
                <span>${r}</span>
              </label>
            `
          })
          .join('')
      }

      filterModal.showModal()
    })

    btnCancelFilter.addEventListener('click', () => {
      filterModal.close()
    })

    btnClearFilter.addEventListener('click', () => {
      this.commentFilterState = { type: 'all', authors: [], reviewers: [] }
      filterModal.close()
      this.renderCommentsDrawer()
    })

    btnApplyFilter.addEventListener('click', () => {
      const selectedAuthors = Array.from(
        filterModal.querySelectorAll<HTMLInputElement>('.chk-filter-author:checked'),
      ).map((el) => el.value)
      const selectedReviewers = Array.from(
        filterModal.querySelectorAll<HTMLInputElement>('.chk-filter-reviewer:checked'),
      ).map((el) => el.value)

      this.commentFilterState = {
        type: currentModalType,
        authors: selectedAuthors,
        reviewers: selectedReviewers,
      }
      filterModal.close()
      this.renderCommentsDrawer()
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

    // Rename Document Dialog Bindings
    const renameDialog = this.container.querySelector<HTMLDialogElement>('#renameDocDialog')!
    const btnCancelRename = this.container.querySelector<HTMLButtonElement>('#btnCancelRenameDoc')!
    const btnConfirmRename = this.container.querySelector<HTMLButtonElement>('#btnConfirmRenameDoc')!
    const inputRename = this.container.querySelector<HTMLInputElement>('#inputRenameDocPath')!

    btnCancelRename.addEventListener('click', () => {
      renameDialog.close()
      this.pendingActionDocPath = null
    })

    btnConfirmRename.addEventListener('click', async () => {
      const oldPath = this.pendingActionDocPath
      const newPath = inputRename.value.trim()
      if (!oldPath || !newPath) return

      try {
        await api.renameDocument(this.projectId, oldPath, newPath)
        renameDialog.close()
        this.pendingActionDocPath = null
        this.showFlash('Document renamed successfully', 'success')
        await this.refreshTree()
        if (this.docPath === oldPath) {
          await this.openDocument(newPath)
        }
      } catch (err: any) {
        this.showFlash(err.message || 'Error renaming document', 'error')
      }
    })

    // Delete Document Dialog Bindings
    const deleteDialog = this.container.querySelector<HTMLDialogElement>('#deleteDocDialog')!
    const btnCancelDelete = this.container.querySelector<HTMLButtonElement>('#btnCancelDeleteDoc')!
    const btnConfirmDelete = this.container.querySelector<HTMLButtonElement>('#btnConfirmDeleteDoc')!

    btnCancelDelete.addEventListener('click', () => {
      deleteDialog.close()
      this.pendingActionDocPath = null
    })

    btnConfirmDelete.addEventListener('click', async () => {
      const targetPath = this.pendingActionDocPath
      if (!targetPath) return

      try {
        await api.deleteDocument(this.projectId, targetPath)
        deleteDialog.close()
        this.pendingActionDocPath = null
        this.showFlash('Document deleted successfully', 'success')
        await this.refreshTree()

        // If currently open doc was deleted, open another or clear
        if (this.docPath === targetPath) {
          const firstDoc = this.findFirstDoc(this.tree)
          if (firstDoc) {
            await this.openDocument(firstDoc.path)
          } else {
            this.docPath = ''
            const headerDoc = this.container.querySelector<HTMLElement>('#headerDocPath')!
            headerDoc.textContent = ''
            const readContent = this.container.querySelector<HTMLElement>('#readContent')!
            readContent.innerHTML = `<div style="padding: 24px; color: var(--text-muted); text-align: center;">${i18n.t.workspace.noDocSelected}</div>`
          }
        }
      } catch (err: any) {
        this.showFlash(err.message || 'Error deleting document', 'error')
      }
    })
  }

  private showConflictDialog(conflict: ConflictPreview): void {
    const t = i18n.t
    const dialog = this.container.querySelector<HTMLDialogElement>('#conflictDialog')!
    const container = this.container.querySelector<HTMLElement>('#conflictBlocksContainer')!
    const btnCancel = this.container.querySelector<HTMLButtonElement>('#btnCancelConflict')!
    const btnResolve = this.container.querySelector<HTMLButtonElement>('#btnResolveAndPublish')!

    container.innerHTML = (conflict.chunks || []).map((c: ConflictBlock, i: number) => {
      return `
        <div style="background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 12px;">
          <div style="font-weight: 600; font-size: 12px; margin-bottom: 8px;">${t.workspace.conflictBlockHeader} #${i + 1} (${c.type})</div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
            <div style="background: var(--accent-subtle); padding: 8px; border-radius: var(--radius-sm); font-size: 11px;">
              <b style="color: var(--accent-primary);">${t.workspace.yourVersionDraft}</b>
              <pre style="margin: 4px 0 0; font-family: var(--font-mono);">${c.ours}</pre>
            </div>
            <div style="background: var(--danger-bg); padding: 8px; border-radius: var(--radius-sm); font-size: 11px;">
              <b style="color: var(--danger-text);">${t.workspace.remoteVersionMain}</b>
              <pre style="margin: 4px 0 0; font-family: var(--font-mono);">${c.theirs}</pre>
            </div>
          </div>

          <div style="display: flex; gap: 8px; align-items: center;">
            <label style="font-size: 12px;"><input type="radio" name="conflict-choice-${i}" value="ours" checked /> ${t.workspace.keepMine}</label>
            <label style="font-size: 12px;"><input type="radio" name="conflict-choice-${i}" value="theirs" /> ${t.workspace.keepMain}</label>
          </div>
        </div>
      `
    }).join('')

    btnCancel.onclick = () => dialog.close()
    btnResolve.onclick = async () => {
      dialog.close()
      try {
        await api.publishDocument(this.projectId, this.docPath, conflict.resolvedContent || this.crepe?.getMarkdown())
        this.showFlash(t.workspace.publishedSuccess, 'success')
        await this.switchMode('read')
      } catch (err: any) {
        this.showFlash(err.message || 'Failed to resolve conflict', 'error')
      }
    }

    dialog.showModal()
  }

  private downloadMarkdownFile(): void {
    const md = this.currentDoc?.content || ''
    const filename = this.docPath ? this.docPath.split('/').pop()! : 'document.md'
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename.endsWith('.md') ? filename : `${filename}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  private exportStandaloneHtml(): void {
    const md = this.currentDoc?.content || ''
    const title = this.docPath ? this.docPath.split('/').pop()?.replace(/\.md$/, '')! : 'Document'
    const bodyHtml = renderToHtml(md)
    const fullHtml = `<!DOCTYPE html>
<html lang="${i18n.getLocale()}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; max-width: 860px; margin: 40px auto; padding: 0 20px; color: #1e293b; background: #ffffff; }
    pre { background: #f1f5f9; padding: 14px; border-radius: 6px; overflow-x: auto; border: 1px solid #e2e8f0; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
    th { background: #f8fafc; font-weight: 600; }
    blockquote { border-left: 4px solid #3b82f6; margin: 16px 0; padding-left: 16px; color: #475569; }
    img { max-width: 100%; height: auto; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  private exportPrintPdf(): void {
    window.print()
  }

  destroy(): void {
    if (this.sse) {
      this.sse.close()
      this.sse = null
    }
    if (this.treePollTimer) {
      clearInterval(this.treePollTimer)
      this.treePollTimer = null
    }
    if (this.autosaveTimer) {
      clearInterval(this.autosaveTimer)
      this.autosaveTimer = null
    }
  }
}
