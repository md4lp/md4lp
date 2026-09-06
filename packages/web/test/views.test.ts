// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LoginView } from '../src/views/LoginView'
import { DashboardView } from '../src/views/DashboardView'
import { TeamsView } from '../src/views/TeamsView'
import { ProjectSettingsView } from '../src/views/ProjectSettingsView'
import { SettingsView } from '../src/views/SettingsView'
import { AuthorizeAgentView } from '../src/views/AuthorizeAgentView'
import { api } from '../src/services/api'

describe('Web SPA Views Comprehensive Suite', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
        this.open = true
      })
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
        this.open = false
      })
    }
    if (!Range.prototype.getClientRects) {
      Range.prototype.getClientRects = () => [] as any
    }
    if (!Range.prototype.getBoundingClientRect) {
      Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} }) as any
    }
    const store: Record<string, string> = {}
    const mockStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, val: string) => { store[key] = val },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { for (const k in store) delete store[k] },
      length: 0,
      key: () => null,
    }
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true,
    })
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'localStorage', {
        value: mockStorage,
        writable: true,
        configurable: true,
      })
    }
    vi.restoreAllMocks()
  })

  it('renders LoginView and step transitions (Email -> Register -> OTP Code)', async () => {
    const view = new LoginView(container)
    view.render()

    expect(container.querySelector('#inputIdentifier')).not.toBeNull()
    expect(container.querySelector('#btnContinue')).not.toBeNull()
    expect(container.querySelector('#stepRegister')?.getAttribute('style')).toContain('display: none')
    expect(container.querySelector('#stepCode')?.getAttribute('style')).toContain('display: none')

    // Mock new user lookup & code request
    vi.spyOn(api, 'lookupIdentifier').mockResolvedValueOnce({ exists: false })
    const btnSubmit = container.querySelector<HTMLButtonElement>('#btnContinue')!
    const inputId = container.querySelector<HTMLInputElement>('#inputIdentifier')!
    inputId.value = 'newuser@company.com'
    btnSubmit.click()

    await new Promise((r) => setTimeout(r, 10))
    expect(container.querySelector('#stepRegister')?.getAttribute('style')).not.toContain('display: none')
  })

  it('renders DashboardView with projects grid, new project creation, and notifications modal', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValueOnce({
      ok: true,
      user: { id: 'u1', name: 'Alice', username: 'alice', emails: [{ email: 'alice@a.com', verified: true, primary: true }] },
    })
    vi.spyOn(api, 'listProjects').mockResolvedValueOnce({
      ok: true,
      projects: [
        { id: 'p1', name: 'Docs Repo', slug: 'docs-repo', effectiveRole: 'owner', createdAt: '2026-09-05' },
      ],
    })
    vi.spyOn(api, 'listPendingProjectInvitations').mockResolvedValueOnce({ ok: true, invitations: [] })
    vi.spyOn(api, 'listPendingTeamInvitations').mockResolvedValueOnce({ ok: true, invitations: [] })

    const view = new DashboardView(container)
    await view.render()

    expect(container.textContent).toContain('Docs Repo')
    expect(container.textContent).toContain('Owner')
    expect(container.querySelector('#btnNewProject')).not.toBeNull()
    expect(container.querySelector('#btnGoTeams')).not.toBeNull()
    expect(container.querySelector('#btnUserProfileSettings')).not.toBeNull()
    expect(container.querySelector('#selectHeaderLocale')).not.toBeNull()
  })

  it('renders TeamsView with private teams list and corporate domain teams auto-detected', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValueOnce({
      ok: true,
      user: { id: 'u1', name: 'Alice', username: 'alice', defaultEmail: 'alice@corp.com', emails: [{ email: 'alice@corp.com', verified: true, primary: true }] },
    })
    vi.spyOn(api, 'listTeams').mockResolvedValueOnce({
      ok: true,
      teams: [{ id: 't1', name: 'Platform Core', type: 'private', members: [{ userId: 'u1', role: 'admin' }] }],
      domainTeams: [{ id: 'dt1', name: 'corp.com Team', type: 'domain', domain: 'corp.com' }],
    })

    const view = new TeamsView(container)
    await view.render()

    expect(container.textContent).toContain('Platform Core')
    expect(container.textContent).toContain('Corporate Domain Teams')
    expect(container.textContent).toContain('corp.com Team')
    expect(container.querySelector('#btnOpenCreateTeam')).not.toBeNull()

    const joinBtn = container.querySelector<HTMLButtonElement>('.btn-join-domain')!
    expect(joinBtn).not.toBeNull()
    const joinSpy = vi.spyOn(api, 'joinDomainTeam').mockResolvedValueOnce({ ok: true, team: {} as any })
    joinBtn.click()
    expect(joinSpy).toHaveBeenCalledWith('dt1', 'alice@corp.com')
  })

  it('renders ProjectSettingsView (Share & Settings) with context Git email, members, assigned teams, and authorized AI agents', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValueOnce({
      ok: true,
      user: { id: 'u1', name: 'Alice', username: 'alice', emails: [{ email: 'alice@work.com', verified: true, primary: true }] },
    })
    vi.spyOn(api, 'listProjects').mockResolvedValueOnce({
      ok: true,
      projects: [{ id: 'p1', name: 'Platform Docs', slug: 'platform-docs', effectiveRole: 'owner', createdAt: '2026-09-05' }],
    })
    vi.spyOn(api, 'getProjectDetails').mockResolvedValueOnce({
      ok: true,
      project: {
        id: 'p1',
        name: 'Platform Docs',
        slug: 'platform-docs',
        effectiveRole: 'owner',
        currentContextEmail: 'alice@domain.com',
        members: [{ userId: 'u1', username: 'alice', role: 'owner', contextEmail: 'alice@domain.com' }],
        pendingInvitations: [{ id: 'inv1', targetEmail: 'guest@external.com', role: 'commenter', status: 'pending', expiresAt: Date.now() + 86400000 }],
        teams: [{ teamId: 't1', teamName: 'Core Team', teamType: 'private', role: 'editor' }],
      },
    } as any)
    vi.spyOn(api, 'listTeams').mockResolvedValueOnce({ ok: true, teams: [], domainTeams: [] })
    vi.spyOn(api, 'listAgentSessions').mockResolvedValueOnce({
      ok: true,
      sessions: [{ id: 's1', agentName: 'Claude Agent', tokenPrefix: 'agt_claude', projectScopes: [{ projectId: 'p1', maxRole: 'editor' }], absoluteExpiresAt: Date.now() + 10000, idleExpiresAt: Date.now() + 5000 }],
    })

    const view = new ProjectSettingsView(container, 'platform-docs')
    await view.render()

    expect(container.textContent).toContain('Share & Settings: Platform Docs')
    expect(container.textContent).toContain('Git Author Signature')
    expect(container.textContent).toContain('Direct Project Members')
    expect(container.textContent).toContain('guest@external.com')
    expect(container.textContent).toContain('Pending')
    expect(container.textContent).toContain('Core Team')
    expect(container.textContent).toContain('Claude Agent')
    expect(container.textContent).toContain('Revoke Access')
  })

  it('handles project actions with non-blocking flash banner (update email, revoke invite, revoke agent)', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({
      ok: true,
      user: { id: 'u1', name: 'Alice', username: 'alice', emails: [{ email: 'alice@work.com', verified: true, primary: true }] },
    })
    vi.spyOn(api, 'listProjects').mockResolvedValue({
      ok: true,
      projects: [{ id: 'p1', name: 'Platform Docs', slug: 'platform-docs', effectiveRole: 'owner', createdAt: '2026-09-05' }],
    })
    vi.spyOn(api, 'getProjectDetails').mockResolvedValue({
      ok: true,
      project: {
        id: 'p1',
        name: 'Platform Docs',
        slug: 'platform-docs',
        effectiveRole: 'owner',
        currentContextEmail: 'alice@work.com',
        members: [{ userId: 'u1', username: 'alice', role: 'owner', contextEmail: 'alice@work.com' }],
        pendingInvitations: [{ id: 'inv1', targetEmail: 'guest@external.com', role: 'commenter', status: 'pending', expiresAt: Date.now() + 86400000 }],
        teams: [],
      },
    } as any)
    vi.spyOn(api, 'listTeams').mockResolvedValue({ ok: true, teams: [], domainTeams: [] })
    vi.spyOn(api, 'listAgentSessions').mockResolvedValue({
      ok: true,
      sessions: [{ id: 's1', agentName: 'Claude Agent', tokenPrefix: 'agt_claude', projectScopes: [{ projectId: 'p1', maxRole: 'editor' }], absoluteExpiresAt: Date.now() + 10000, idleExpiresAt: Date.now() + 5000 }],
    })

    const view = new ProjectSettingsView(container, 'platform-docs')
    await view.render()

    const flashEl = container.querySelector<HTMLElement>('#projHeaderFlash')!
    expect(flashEl.style.display).toBe('none')

    // 1. Update context signature email -> triggers flash banner
    const updateEmailSpy = vi.spyOn(api, 'updateProjectContextEmail').mockResolvedValueOnce({ ok: true })
    const btnUpdateEmail = container.querySelector<HTMLButtonElement>('#btnUpdateContextEmail')!
    btnUpdateEmail.click()
    await new Promise((r) => setTimeout(r, 10))

    expect(updateEmailSpy).toHaveBeenCalledWith('p1', 'alice@work.com')
    expect(flashEl.style.display).toBe('inline-flex')
    expect(flashEl.textContent).toBe('Git signature email updated')

    // 2. Revoke pending invitation -> triggers api call and flash banner
    const revokeInvSpy = vi.spyOn(api, 'revokeProjectInvitation').mockResolvedValueOnce({ ok: true })
    const btnRevokeInv = container.querySelector<HTMLButtonElement>('.btn-revoke-invite')!
    btnRevokeInv.click()
    await new Promise((r) => setTimeout(r, 10))

    expect(revokeInvSpy).toHaveBeenCalledWith('p1', 'inv1')
    expect(flashEl.textContent).toBe('Invitation revoked')

    // 3. Revoke AI agent access -> triggers api call and flash banner
    const revokeAgentSpy = vi.spyOn(api, 'revokeAgentSession').mockResolvedValueOnce({ ok: true })
    const btnRevokeAgent = container.querySelector<HTMLButtonElement>('.btn-revoke-agent')!
    btnRevokeAgent.click()
    await new Promise((r) => setTimeout(r, 10))

    expect(revokeAgentSpy).toHaveBeenCalledWith('s1')
    expect(flashEl.textContent).toBe('Agent session revoked')
  })

  it('prompts user in TeamsView if attempting to join domain team without verified domain email', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'u1',
        name: 'Alice',
        username: 'alice',
        emails: [{ email: 'alice@personal.org', verified: true, primary: true }],
      },
    })
    vi.spyOn(api, 'listTeams').mockResolvedValueOnce({
      ok: true,
      teams: [],
      domainTeams: [{ id: 'dt1', name: 'Mobilife Team', domain: 'mobilife.es', memberCount: 5 }],
    })
    vi.spyOn(api, 'listPendingTeamInvitations').mockResolvedValueOnce({ ok: true, invitations: [] })

    const view = new TeamsView(container)
    await view.render()

    const flashEl = container.querySelector<HTMLElement>('#teamsHeaderFlash')!
    expect(flashEl.style.display).toBe('none')

    const joinBtn = container.querySelector<HTMLButtonElement>('.btn-join-domain')!
    expect(joinBtn).not.toBeNull()
    joinBtn.click()

    expect(flashEl.style.display).toBe('inline-flex')
    expect(flashEl.textContent).toContain('@mobilife.es')
  })

  it('renders SettingsView with Appearance theme switcher, verified emails list, and resolves project names for AI agents', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'u1',
        name: 'Alice',
        username: 'alice',
        emails: [
          { email: 'primary@acme.com', verified: true, primary: true },
          { email: 'secondary@other.org', verified: true, primary: false },
        ],
      },
    })
    vi.spyOn(api, 'listProjects').mockResolvedValueOnce({
      ok: true,
      projects: [{ id: 'p-123-uuid', name: 'Engineering Documentation', slug: 'eng-docs', effectiveRole: 'owner', createdAt: '2026-09-05' }],
    })
    vi.spyOn(api, 'listAgentSessions').mockResolvedValueOnce({
      ok: true,
      sessions: [
        {
          id: 's1',
          agentName: 'Antigravity Agent',
          tokenPrefix: 'md4lp_agt_arQm',
          projectScopes: [{ projectId: 'p-123-uuid', maxRole: 'editor' }],
          absoluteExpiresAt: Date.now() + 100000,
          idleExpiresAt: Date.now() + 50000,
        },
      ],
    })

    const view = new SettingsView(container)
    await view.render()

    expect(container.textContent).toContain('Appearance')
    expect(container.textContent).toContain('Language')
    expect(container.textContent).toContain('🇬🇧 English')
    expect(container.textContent).toContain('🇪🇸 Español')
    expect(container.textContent).toContain('💻 System')
    expect(container.textContent).toContain('☀️ Light')
    expect(container.textContent).toContain('🌙 Dark')
    expect(container.textContent).toContain('primary@acme.com')
    expect(container.textContent).toContain('secondary@other.org')
    expect(container.textContent).toContain('Antigravity Agent')
    // Resolved project name and role tag instead of UUID
    expect(container.textContent).toContain('Engineering Documentation')
    expect(container.textContent).toContain('editor')
    expect(container.textContent).not.toContain('Invalid Date')
  })

  it('renders AuthorizeAgentView with project scope matrix and consent button', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValueOnce({
      ok: true,
      user: { id: 'u1', name: 'Alice', username: 'alice', emails: [] },
    })
    vi.spyOn(api, 'listProjects').mockResolvedValueOnce({
      ok: true,
      projects: [{ id: 'p1', name: 'Frontend Docs', slug: 'frontend-docs', effectiveRole: 'owner', createdAt: '2026-09-05' }],
    })

    const query = new URLSearchParams([
      ['client_name', 'Cursor IDE Agent'],
      ['code_challenge', 'challenge_test'],
      ['redirect_uri', 'http://127.0.0.1:8799/callback'],
      ['state', 'state_xyz'],
    ])

    const view = new AuthorizeAgentView(container, query)
    await view.render()

    expect(container.textContent).toContain('Authorize AI Agent')
    expect(container.textContent).toContain('Cursor IDE Agent')
    expect(container.textContent).toContain('Frontend Docs')
    expect(container.querySelector('#btnGrantAgentAccess')).not.toBeNull()
  })

  it('renders WorkspaceView with document tree, read mode, and comments drawer', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValueOnce({
      ok: true,
      projects: [{ id: 'p1', name: 'Frontend Docs', slug: 'frontend-docs', effectiveRole: 'owner', createdAt: '2026-09-05' }],
    })
    vi.spyOn(api, 'listTree').mockResolvedValueOnce({
      ok: true,
      tree: [{ name: 'README.md', path: 'README.md', type: 'file' }],
    })
    vi.spyOn(api, 'getDocument').mockResolvedValueOnce({
      ok: true,
      projectId: 'p1',
      path: 'README.md',
      content: '# Hello Workspace',
      branch: 'main',
      lock: { editor: null },
    })
    vi.spyOn(api, 'getComments').mockResolvedValueOnce({ ok: true, comments: [] })

    const { WorkspaceView } = await import('../src/views/WorkspaceView')
    const view = new WorkspaceView(container, 'frontend-docs', 'README.md')
    await view.render()

    expect(container.textContent).toContain('Frontend Docs')
    expect(container.textContent).toContain('README.md')
    expect(container.querySelector('#treeContainer')).not.toBeNull()
    expect(container.querySelector('#readPane')).not.toBeNull()
    expect(container.querySelector('#editPane')).not.toBeNull()
    expect(container.querySelector('#commentsDrawer')).not.toBeNull()

    // Test Rename Document Modal Flow
    const btnRename = container.querySelector<HTMLButtonElement>('.btn-tree-rename')!
    expect(btnRename).not.toBeNull()
    btnRename.click()

    const renameDialog = container.querySelector<HTMLDialogElement>('#renameDocDialog')!
    const inputRename = container.querySelector<HTMLInputElement>('#inputRenameDocPath')!
    expect(inputRename.value).toBe('README.md')
    inputRename.value = 'intro/README.md'

    const renameSpy = vi.spyOn(api, 'renameDocument').mockResolvedValueOnce({ ok: true, commitOid: 'oid-rename' })
    const btnConfirmRename = container.querySelector<HTMLButtonElement>('#btnConfirmRenameDoc')!
    btnConfirmRename.click()
    await new Promise((r) => setTimeout(r, 10))

    expect(renameSpy).toHaveBeenCalledWith('p1', 'README.md', 'intro/README.md')

    // Test Delete Document Modal Flow
    const btnDelete = container.querySelector<HTMLButtonElement>('.btn-tree-delete')!
    expect(btnDelete).not.toBeNull()
    btnDelete.click()

    const deleteDialog = container.querySelector<HTMLDialogElement>('#deleteDocDialog')!
    expect(container.querySelector('#deleteDocTargetName')?.textContent).toBe('README.md')

    const deleteSpy = vi.spyOn(api, 'deleteDocument').mockResolvedValueOnce({ ok: true, commitOid: 'oid-delete' })
    const btnConfirmDelete = container.querySelector<HTMLButtonElement>('#btnConfirmDeleteDoc')!
    btnConfirmDelete.click()
    await new Promise((r) => setTimeout(r, 10))

    expect(deleteSpy).toHaveBeenCalledWith('p1', 'README.md')
  })

  it('supports document export dropdown (Markdown, HTML, PDF) in Read mode and hides in Edit mode', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValueOnce({
      ok: true,
      projects: [{ id: 'p1', name: 'Frontend Docs', slug: 'frontend-docs', effectiveRole: 'owner', createdAt: '2026-09-05' }],
    })
    vi.spyOn(api, 'listTree').mockResolvedValueOnce({
      ok: true,
      tree: [{ name: 'spec.md', path: 'spec.md', type: 'file' }],
    })
    vi.spyOn(api, 'getDocument').mockResolvedValueOnce({
      ok: true,
      projectId: 'p1',
      path: 'spec.md',
      content: '# Spec Document\n\nContent to export',
      branch: 'main',
      lock: { editor: null },
    })
    vi.spyOn(api, 'getComments').mockResolvedValueOnce({ ok: true, comments: [] })

    // Mock window.print and URL APIs
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    const createObjectURLSpy = vi.fn().mockReturnValue('blob:test-url')
    const revokeObjectURLSpy = vi.fn()
    URL.createObjectURL = createObjectURLSpy
    URL.revokeObjectURL = revokeObjectURLSpy
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const { WorkspaceView } = await import('../src/views/WorkspaceView')
    const view = new WorkspaceView(container, 'frontend-docs', 'spec.md')
    await view.render()

    const exportWrapper = container.querySelector<HTMLElement>('#exportMenuWrapper')!
    expect(exportWrapper).not.toBeNull()
    expect(exportWrapper.style.display).toBe('inline-block')

    const btnExportMenu = container.querySelector<HTMLButtonElement>('#btnExportMenu')!
    const exportDropdown = container.querySelector<HTMLElement>('#exportDropdownMenu')!
    expect(exportDropdown.style.display).toBe('none')

    // Open export dropdown menu
    btnExportMenu.click()
    expect(exportDropdown.style.display).toBe('flex')

    // Click Export Markdown
    const btnDownloadMd = container.querySelector<HTMLButtonElement>('#btnExportDownloadMd')!
    btnDownloadMd.click()
    expect(createObjectURLSpy).toHaveBeenCalled()
    expect(exportDropdown.style.display).toBe('none')

    // Click Export HTML
    btnExportMenu.click()
    const btnDownloadHtml = container.querySelector<HTMLButtonElement>('#btnExportDownloadHtml')!
    btnDownloadHtml.click()
    expect(createObjectURLSpy).toHaveBeenCalledTimes(2)

    // Click Export PDF
    btnExportMenu.click()
    const btnPrintPdf = container.querySelector<HTMLButtonElement>('#btnExportPrintPdf')!
    btnPrintPdf.click()
    expect(printSpy).toHaveBeenCalled()

    // Switch to edit mode -> export wrapper should be hidden
    vi.spyOn(api, 'acquireLock').mockResolvedValueOnce({ ok: true, lock: { editor: 'alice', expiresAt: '2026-09-06T20:00:00Z' } } as any)
    const btnModeEdit = container.querySelector<HTMLButtonElement>('#btnModeEdit')!
    btnModeEdit.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(exportWrapper.style.display).toBe('none')

    // Restore URL mocks
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
  })

  it('supports dynamic canvas width switching (standard, wide, full) and element breakout containers in WorkspaceView', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValueOnce({
      ok: true,
      projects: [{ id: 'p1', name: 'Frontend Docs', slug: 'frontend-docs', effectiveRole: 'owner', createdAt: '2026-09-05' }],
    })
    vi.spyOn(api, 'listTree').mockResolvedValueOnce({
      ok: true,
      tree: [{ name: 'guide.md', path: 'guide.md', type: 'file' }],
    })
    vi.spyOn(api, 'getDocument').mockResolvedValueOnce({
      ok: true,
      projectId: 'p1',
      path: 'guide.md',
      content: `# Guide\n\n| Col A | Col B |\n|---|---|\n| Val 1 | Val 2 |\n\n\`\`\`typescript\nconst count = 42;\n\`\`\``,
      branch: 'main',
      lock: { editor: null },
    })
    vi.spyOn(api, 'getComments').mockResolvedValueOnce({ ok: true, comments: [] })

    // Mock clipboard
    const writeTextSpy = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy,
      },
    })

    const { WorkspaceView } = await import('../src/views/WorkspaceView')
    const view = new WorkspaceView(container, 'frontend-docs', 'guide.md')
    await view.render()

    const workspaceMain = container.querySelector<HTMLElement>('#workspaceMain')!
    expect(workspaceMain.classList.contains('canvas-width-standard')).toBe(true)

    const btnCanvasWidth = container.querySelector<HTMLButtonElement>('#btnCanvasWidth')!
    const canvasWidthDropdown = container.querySelector<HTMLElement>('#canvasWidthDropdown')!
    expect(canvasWidthDropdown.style.display).toBe('none')

    // 1. Open Canvas Width Dropdown
    btnCanvasWidth.click()
    expect(canvasWidthDropdown.style.display).toBe('flex')

    // 2. Select Wide Mode (1240px)
    const btnWide = container.querySelector<HTMLButtonElement>('.btn-canvas-width-opt[data-width="wide"]')!
    btnWide.click()
    expect(workspaceMain.classList.contains('canvas-width-wide')).toBe(true)
    expect(workspaceMain.classList.contains('canvas-width-standard')).toBe(false)
    expect(localStorage.getItem('md4lp_canvas_width')).toBe('wide')
    expect(canvasWidthDropdown.style.display).toBe('none')

    // 3. Select Full Mode (100%)
    btnCanvasWidth.click()
    const btnFull = container.querySelector<HTMLButtonElement>('.btn-canvas-width-opt[data-width="full"]')!
    btnFull.click()
    expect(workspaceMain.classList.contains('canvas-width-full')).toBe(true)
    expect(localStorage.getItem('md4lp_canvas_width')).toBe('full')

    // 4. Verify Breakout Containers around Table and Code
    const tableWrapper = container.querySelector<HTMLElement>('.table-breakout-wrapper')!
    expect(tableWrapper).not.toBeNull()
    expect(tableWrapper.querySelector('table')).not.toBeNull()

    const btnToggleTableBreakout = tableWrapper.querySelector<HTMLButtonElement>('.btn-toggle-breakout')!
    expect(tableWrapper.classList.contains('is-breakout')).toBe(false)

    // Toggle table breakout
    btnToggleTableBreakout.click()
    expect(tableWrapper.classList.contains('is-breakout')).toBe(true)
    btnToggleTableBreakout.click()
    expect(tableWrapper.classList.contains('is-breakout')).toBe(false)

    // 5. Verify Code Block Breakout & Copy Button
    const codeWrapper = container.querySelector<HTMLElement>('.code-breakout-wrapper')!
    expect(codeWrapper).not.toBeNull()
    expect(codeWrapper.textContent).toContain('TYPESCRIPT')

    const btnToggleCodeBreakout = codeWrapper.querySelector<HTMLButtonElement>('.btn-toggle-breakout')!
    btnToggleCodeBreakout.click()
    expect(codeWrapper.classList.contains('is-breakout')).toBe(true)

    const btnCopyCode = codeWrapper.querySelector<HTMLButtonElement>('.btn-copy-code')!
    btnCopyCode.click()
    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('const count = 42;'))

    // 6. Test Manual & Auto Tree Refresh
    const btnRefreshTree = container.querySelector<HTMLButtonElement>('#btnRefreshTree')!
    expect(btnRefreshTree).not.toBeNull()

    const listTreeSpy = vi.spyOn(api, 'listTree').mockResolvedValueOnce({
      ok: true,
      tree: [
        { name: 'guide.md', path: 'guide.md', type: 'file' },
        { name: 'new-file.md', path: 'new-file.md', type: 'file' },
      ],
    })

    btnRefreshTree.click()
    await new Promise((r) => setTimeout(r, 20))
    expect(listTreeSpy).toHaveBeenCalledWith('p1')
    expect(container.textContent).toContain('new-file.md')

    view.destroy()
  })

  it('supports comments filtering, pending/total badge count, and tree drag-and-drop in WorkspaceView', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValueOnce({
      ok: true,
      projects: [{ id: 'p1', name: 'Frontend Docs', slug: 'frontend-docs', effectiveRole: 'owner', createdAt: '2026-09-05' }],
    })
    vi.spyOn(api, 'listTree').mockResolvedValueOnce({
      ok: true,
      tree: [
        {
          name: 'guides',
          path: 'guides',
          type: 'directory',
          children: [{ name: 'api.md', path: 'guides/api.md', type: 'file' }],
        },
        { name: 'intro.md', path: 'intro.md', type: 'file' },
      ],
    })
    vi.spyOn(api, 'getDocument').mockResolvedValueOnce({
      ok: true,
      projectId: 'p1',
      path: 'intro.md',
      content: '# Intro Content',
      branch: 'main',
      lock: { editor: null },
    })
    vi.spyOn(api, 'getComments').mockResolvedValueOnce({
      ok: true,
      comments: [
        {
          owner: 'alice',
          resolution: { status: 'intact', start: 0, end: 10 },
          comment: {
            id: 'c1',
            author: 'Alice',
            body: 'Pending review suggestion',
            status: 'open',
            suggestion: 'New text',
          } as any,
        },
        {
          owner: 'bob',
          resolution: { status: 'intact', start: 0, end: 10 },
          comment: {
            id: 'c2',
            author: 'Bob',
            body: 'Already resolved note',
            status: 'resolved',
          } as any,
        },
      ],
    })

    const { WorkspaceView } = await import('../src/views/WorkspaceView')
    const view = new WorkspaceView(container, 'frontend-docs', 'intro.md')
    await view.render()

    // 1. Check Header Badge has "1/2" (1 pending / 2 total)
    const badgeEl = container.querySelector<HTMLElement>('#commentsCountBadge')!
    expect(badgeEl.textContent).toBe('1/2')

    // 2. Comments List starts in 'all' mode (2 comment cards)
    let commentCards = container.querySelectorAll('.comment-thread-card')
    expect(commentCards).toHaveLength(2)

    // 3. Switch filter to Pending Only
    const btnPending = container.querySelector<HTMLButtonElement>('#btnFilterPending')!
    btnPending.click()
    commentCards = container.querySelectorAll('.comment-thread-card')
    expect(commentCards).toHaveLength(1)
    expect(container.textContent).toContain('Pending review suggestion')
    expect(container.textContent).not.toContain('Already resolved note')

    // 4. Switch filter back to All
    const btnAll = container.querySelector<HTMLButtonElement>('#btnFilterAll')!
    btnAll.click()
    commentCards = container.querySelectorAll('.comment-thread-card')
    expect(commentCards).toHaveLength(2)

    // 5. Test Advanced Filter Modal: Open modal and filter by "Suggestions"
    const btnOpenFilter = container.querySelector<HTMLButtonElement>('#btnOpenCommentsFilter')!
    btnOpenFilter.click()

    const filterModal = container.querySelector<HTMLDialogElement>('#commentsFilterModal')!
    expect(filterModal).not.toBeNull()

    const btnSuggType = filterModal.querySelector<HTMLButtonElement>('.btn-modal-filter-type[data-type="suggestions"]')!
    expect(btnSuggType).not.toBeNull()
    btnSuggType.click()

    const btnApplyFilter = container.querySelector<HTMLButtonElement>('#btnApplyCommentsFilter')!
    btnApplyFilter.click()

    // Filter indicator badge should be active
    const filterBadge = container.querySelector<HTMLElement>('#activeFilterBadge')!
    expect(filterBadge.style.display).toBe('inline-block')

    // Only suggestion card is shown (Pending review suggestion)
    commentCards = container.querySelectorAll('.comment-thread-card')
    expect(commentCards).toHaveLength(1)
    expect(container.textContent).toContain('Pending review suggestion')

    // Test Multi-Select Author Filter: Open modal, pick Alice
    btnOpenFilter.click()
    const btnAllType = filterModal.querySelector<HTMLButtonElement>('.btn-modal-filter-type[data-type="all"]')!
    btnAllType.click()

    const authorChk = filterModal.querySelector<HTMLInputElement>('.chk-filter-author[value="Alice"]')!
    expect(authorChk).not.toBeNull()
    authorChk.checked = true

    btnApplyFilter.click()
    commentCards = container.querySelectorAll('.comment-thread-card')
    expect(commentCards).toHaveLength(1)
    expect(container.textContent).toContain('Pending review suggestion')
    expect(btnOpenFilter.title).toContain('Authors: Alice')

    // Test Clear Filters
    btnOpenFilter.click()
    const btnClear = container.querySelector<HTMLButtonElement>('#btnClearCommentsFilter')!
    btnClear.click()
    expect(filterBadge.style.display).toBe('none')
    expect(btnOpenFilter.title).toContain('None active')
    commentCards = container.querySelectorAll('.comment-thread-card')
    expect(commentCards).toHaveLength(2)

    // 6. Test Floating Mode & Publish Bar in Main Workspace Area
    const floatingBar = container.querySelector<HTMLElement>('#floatingModeBar')!
    expect(floatingBar).not.toBeNull()
    expect(container.querySelector('#workspaceMain')?.contains(floatingBar)).toBe(true)

    // 7. Test Tree Drag & Drop:
    // Dropping over a file (e.g. intro.md) is NOT allowed and should not open rename modal
    const fileElement = container.querySelector<HTMLElement>('.tree-file[data-path="intro.md"]')!
    const invalidDrop = new Event('drop', { bubbles: true, cancelable: true }) as any
    invalidDrop.dataTransfer = { getData: () => 'guides/api.md' }
    fileElement.dispatchEvent(invalidDrop)

    // Dropping intro.md into guides directory opens Rename / Move dialog
    const dirElement = container.querySelector<HTMLElement>('.tree-dir[data-path="guides"]')!
    expect(dirElement).not.toBeNull()

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as any
    dropEvent.dataTransfer = {
      getData: (type: string) => (type === 'text/plain' ? 'intro.md' : ''),
    }
    dirElement.dispatchEvent(dropEvent)

    // Verify Rename / Move dialog was opened with 'guides/intro.md'
    const renameDialog = container.querySelector<HTMLDialogElement>('#renameDocDialog')!
    const inputRename = container.querySelector<HTMLInputElement>('#inputRenameDocPath')!
    expect(inputRename.value).toBe('guides/intro.md')
  })

  it('enforces owner-only member removal and OTP verification in ProjectSettingsView', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({
      ok: true,
      user: {
        id: 'u1',
        name: 'Alice Owner',
        username: 'alice',
        defaultEmail: 'alice@company.com',
        emails: [{ email: 'alice@company.com', verified: true, primary: true }],
      },
    })
    vi.spyOn(api, 'listProjects').mockResolvedValue({
      ok: true,
      projects: [{ id: 'p1', name: 'Platform Docs', slug: 'platform-docs', effectiveRole: 'owner', createdAt: '2026-09-05' }],
    })
    vi.spyOn(api, 'getProjectDetails').mockResolvedValue({
      ok: true,
      project: {
        id: 'p1',
        name: 'Platform Docs',
        slug: 'platform-docs',
        effectiveRole: 'owner',
        currentContextEmail: 'alice@company.com',
        members: [
          { userId: 'u1', username: 'alice', role: 'owner', contextEmail: 'alice@company.com' },
          { userId: 'u2', username: 'bob', role: 'editor', contextEmail: 'bob@company.com' },
        ],
        pendingInvitations: [],
        teams: [{ teamId: 't1', teamName: 'Core Devs', teamType: 'private', role: 'editor' }],
      },
    } as any)
    vi.spyOn(api, 'listTeams').mockResolvedValue({ ok: true, teams: [], domainTeams: [] })
    vi.spyOn(api, 'listAgentSessions').mockResolvedValue({ ok: true, sessions: [] })

    const view = new ProjectSettingsView(container, 'platform-docs')
    await view.render()

    // Owner can see Invite and Assign Team rows
    expect(container.querySelector<HTMLElement>('#inviteMemberRow')?.style.display).toBe('flex')
    expect(container.querySelector<HTMLElement>('#assignTeamRow')?.style.display).toBe('flex')

    // Remove Member button is rendered for Bob (not Alice)
    const removeBtns = container.querySelectorAll<HTMLButtonElement>('.btn-remove-member')
    expect(removeBtns).toHaveLength(1)
    expect(removeBtns[0]!.getAttribute('data-user-id')).toBe('u2')

    // Click Remove Member -> triggers requestCode and opens OTP dialog
    const reqCodeSpy = vi.spyOn(api, 'requestCode').mockResolvedValueOnce({ ok: true, email: 'alice@company.com', expiresInSeconds: 600 })
    removeBtns[0]!.click()
    await new Promise((r) => setTimeout(r, 10))

    expect(reqCodeSpy).toHaveBeenCalledWith({ identifier: 'alice@company.com', purpose: 'remove_project_member' })

    const dialog = container.querySelector<HTMLDialogElement>('#removeMemberOtpDialog')!
    expect(container.querySelector('#removeMemberTargetName')?.textContent).toBe('@bob')

    // Fill OTP code and confirm removal
    const inputOtp = container.querySelector<HTMLInputElement>('#inputRemoveMemberOtp')!
    inputOtp.value = '123456'

    const removeMemberSpy = vi.spyOn(api, 'removeProjectMember').mockResolvedValueOnce({ ok: true })
    const btnConfirm = container.querySelector<HTMLButtonElement>('#btnConfirmRemoveMemberOtp')!
    btnConfirm.click()
    await new Promise((r) => setTimeout(r, 10))

    expect(removeMemberSpy).toHaveBeenCalledWith('p1', 'u2', '123456')
  })

  it('hides management actions for non-owner members in ProjectSettingsView', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({
      ok: true,
      user: {
        id: 'u2',
        name: 'Bob Editor',
        username: 'bob',
        defaultEmail: 'bob@company.com',
        emails: [{ email: 'bob@company.com', verified: true, primary: true }],
      },
    })
    vi.spyOn(api, 'listProjects').mockResolvedValue({
      ok: true,
      projects: [{ id: 'p1', name: 'Platform Docs', slug: 'platform-docs', effectiveRole: 'editor', createdAt: '2026-09-05' }],
    })
    vi.spyOn(api, 'getProjectDetails').mockResolvedValue({
      ok: true,
      project: {
        id: 'p1',
        name: 'Platform Docs',
        slug: 'platform-docs',
        effectiveRole: 'editor',
        currentContextEmail: 'bob@company.com',
        members: [
          { userId: 'u1', username: 'alice', role: 'owner', contextEmail: 'alice@company.com' },
          { userId: 'u2', username: 'bob', role: 'editor', contextEmail: 'bob@company.com' },
        ],
        pendingInvitations: [{ id: 'inv1', targetEmail: 'charlie@company.com', role: 'viewer', status: 'pending' }],
        teams: [{ teamId: 't1', teamName: 'Core Devs', teamType: 'private', role: 'editor' }],
      },
    } as any)
    vi.spyOn(api, 'listTeams').mockResolvedValue({ ok: true, teams: [], domainTeams: [] })
    vi.spyOn(api, 'listAgentSessions').mockResolvedValue({ ok: true, sessions: [] })

    const view = new ProjectSettingsView(container, 'platform-docs')
    await view.render()

    // Non-owner (editor) cannot invite or assign teams
    expect(container.querySelector<HTMLElement>('#inviteMemberRow')?.style.display).toBe('none')
    expect(container.querySelector<HTMLElement>('#assignTeamRow')?.style.display).toBe('none')

    // Non-owner cannot see Remove Member or Remove Team buttons
    expect(container.querySelectorAll('.btn-remove-member')).toHaveLength(0)
    expect(container.querySelectorAll('.btn-remove-proj-team')).toHaveLength(0)
    expect(container.querySelectorAll('.btn-revoke-invite')).toHaveLength(0)
  })
})

