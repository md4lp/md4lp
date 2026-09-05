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
    expect(container.textContent).toContain('owner')
    expect(container.querySelector('#btnNewProject')).not.toBeNull()
    expect(container.querySelector('#btnGoTeams')).not.toBeNull()
    expect(container.querySelector('#btnGoSettings')).not.toBeNull()
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

