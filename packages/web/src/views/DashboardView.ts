import { api, type ProjectSummary, type UserProfile } from '../services/api'
import { router } from '../router'

export class DashboardView {
  private container: HTMLElement
  private user: UserProfile | null = null
  private projects: ProjectSummary[] = []
  private pendingProjectInvs: any[] = []
  private pendingTeamInvs: any[] = []

  constructor(container: HTMLElement) {
    this.container = container
  }

  async render(): Promise<void> {
    this.container.innerHTML = `
      <div style="display: flex; height: 100vh; flex-direction: column; background: var(--bg-app);">
        
        <!-- Header -->
        <header style="position: relative; height: var(--header-height); background: var(--bg-surface); border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between; padding: 0 24px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 20px;">📝</span>
            <span style="font-weight: 700; font-size: 16px; color: var(--text-primary);">md4lp</span>
            <span style="font-size: 12px; color: var(--text-muted); margin-left: 8px;">Projects Dashboard</span>
          </div>

          <!-- Flash Banner in Header (Centered absolutely) -->
          <div id="dashHeaderFlash" style="display: none; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); align-items: center; gap: 8px; font-size: 12px; font-weight: 500; padding: 6px 16px; border-radius: var(--radius-full); box-shadow: var(--shadow-sm); z-index: 10; pointer-events: none; transition: all 0.2s ease;"></div>

          <div id="userBadgeNav" style="display: flex; align-items: center; gap: 12px;">
            <!-- Notifications Bell -->
            <button id="btnOpenNotifications" class="btn btn-ghost" title="Notifications & Action Center" style="position: relative; font-size: 14px; padding: 4px 8px;">
              🔔<span id="notifBadgeCount" style="display: none; position: absolute; top: -2px; right: -2px; background: var(--danger-text); color: #fff; font-size: 9px; font-weight: 700; border-radius: 10px; padding: 1px 4px;">0</span>
            </button>

            <button id="btnGoTeams" class="btn btn-ghost" title="Teams & Organizations" style="font-size: 14px; padding: 4px 8px;">👥 Teams</button>
            <button id="btnGoSettings" class="btn btn-ghost" title="Settings & Account" style="font-size: 14px; padding: 4px 8px;">⚙️ Settings</button>

            <div id="userInfoBlock" style="text-align: right;">
              <div id="navUserName" style="font-size: 13px; font-weight: 600; color: var(--text-primary);"></div>
              <div id="navUserHandle" style="font-size: 11px; color: var(--text-muted);"></div>
            </div>
            <button id="btnLogoutNav" class="btn btn-ghost" style="font-size: 12px;">Sign Out</button>
          </div>
        </header>

        <!-- Main Body -->
        <main style="flex: 1; overflow-y: auto; padding: 32px 24px; max-width: 1000px; width: 100%; margin: 0 auto;">
          
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
            <div>
              <h2 style="font-size: 20px; font-weight: 700; margin: 0 0 4px; color: var(--text-primary);">Your Projects</h2>
              <p style="font-size: 13px; color: var(--text-secondary); margin: 0;">Select a repository workspace to edit or review documentation.</p>
            </div>
            <button id="btnNewProject" class="btn btn-primary">
              <span>+</span> New Project
            </button>
          </div>

          <!-- Create Project Inline Card (Collapsible) -->
          <div id="createProjectCard" style="display: none; background: var(--bg-surface); border: 1px solid var(--accent-subtle); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 24px; box-shadow: var(--shadow-sm);">
            <h3 style="font-size: 15px; font-weight: 600; margin: 0 0 12px;">Create New Project</h3>
            <div id="createProjectError" style="display: none; padding: 8px 12px; border-radius: var(--radius-md); background: var(--danger-bg); color: var(--danger-text); font-size: 12px; margin-bottom: 12px;"></div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
              <div>
                <label style="display: block; font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px;">Project Name</label>
                <input id="inputProjName" class="input" type="text" placeholder="e.g. Platform Documentation" />
              </div>
              <div>
                <label style="display: block; font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px;">Slug Identifier (URL friendly)</label>
                <input id="inputProjSlug" class="input" type="text" placeholder="platform-docs" />
              </div>
            </div>

            <div style="margin-bottom: 16px;">
              <label style="display: block; font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px;">Description</label>
              <input id="inputProjDesc" class="input" type="text" placeholder="Brief summary of this knowledge base" />
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 8px;">
              <button id="btnCancelCreateProj" class="btn btn-ghost">Cancel</button>
              <button id="btnSubmitCreateProj" class="btn btn-primary">Create Repository</button>
            </div>
          </div>

          <!-- Projects Grid -->
          <div id="projectsGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;">
            <div style="padding: 32px; text-align: center; color: var(--text-muted); font-size: 13px;">Loading projects...</div>
          </div>

        </main>
      </div>

      <!-- Action Center / Notifications Modal -->
      <dialog id="notifModal" style="max-width: 500px; width: 90%; border: 1px solid var(--border-default); border-radius: var(--radius-lg); background: var(--bg-surface); color: var(--text-primary); padding: 24px; box-shadow: var(--shadow-lg);">
        <h3 style="margin-top: 0; font-size: 16px;">🔔 Pending Invitations & Actions</h3>
        
        <div id="notifListContainer" style="margin: 16px 0; max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;"></div>

        <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
          <button id="btnCloseNotifModal" class="btn btn-ghost">Close</button>
        </div>
      </dialog>
    `

    this.bindEvents()
    await this.loadData()
  }

  private async loadData(): Promise<void> {
    try {
      const meRes = await api.getMe()
      this.user = meRes.user

      const navName = this.container.querySelector<HTMLElement>('#navUserName')!
      const navHandle = this.container.querySelector<HTMLElement>('#navUserHandle')!
      navName.textContent = this.user.name || this.user.username
      navHandle.textContent = `@${this.user.username}`

      const projsRes = await api.listProjects()
      this.projects = projsRes.projects || []
      this.renderProjectsGrid()

      await this.loadNotifications()
    } catch {
      router.navigate('/login')
    }
  }

  private async loadNotifications(): Promise<void> {
    try {
      const pInvs = await api.listPendingProjectInvitations()
      const tInvs = await api.listPendingTeamInvitations()
      this.pendingProjectInvs = pInvs.invitations || []
      this.pendingTeamInvs = tInvs.invitations || []

      const total = this.pendingProjectInvs.length + this.pendingTeamInvs.length
      const badge = this.container.querySelector<HTMLElement>('#notifBadgeCount')!
      if (total > 0) {
        badge.style.display = 'inline-block'
        badge.textContent = String(total)
      } else {
        badge.style.display = 'none'
      }
    } catch {}
  }

  private renderProjectsGrid(): void {
    const grid = this.container.querySelector<HTMLElement>('#projectsGrid')!
    if (this.projects.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 48px; background: var(--bg-surface); border: 1px dashed var(--border-default); border-radius: var(--radius-lg); text-align: center;">
          <div style="font-size: 32px; margin-bottom: 8px;">📚</div>
          <h3 style="font-size: 15px; font-weight: 600; margin: 0 0 4px; color: var(--text-primary);">No Projects Yet</h3>
          <p style="font-size: 13px; color: var(--text-secondary); margin: 0 0 16px;">Create your first Markdown repository project to begin writing and collaborating.</p>
        </div>
      `
      return
    }

    grid.innerHTML = this.projects.map((p) => {
      const roleColor = p.effectiveRole === 'owner' ? 'badge-green' : p.effectiveRole === 'editor' ? 'badge-blue' : 'badge-orange'
      return `
        <div class="project-card" data-slug="${p.slug}" style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 20px; cursor: pointer; transition: all 0.15s ease; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <h3 style="font-size: 16px; font-weight: 600; margin: 0; color: var(--text-primary);">${p.name}</h3>
              <span class="badge ${roleColor}">${p.effectiveRole}</span>
            </div>
            <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 16px; line-height: 1.4;">${p.description || 'No description provided.'}</p>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-subtle); padding-top: 12px; font-size: 11px; color: var(--text-muted);">
            <span>slug: <code>${p.slug}</code></span>
            <span style="color: var(--accent-primary); font-weight: 500;">Open Workspace →</span>
          </div>
        </div>
      `
    }).join('')

    grid.querySelectorAll<HTMLElement>('.project-card').forEach((card) => {
      card.addEventListener('click', () => {
        const slug = card.getAttribute('data-slug')
        if (slug) {
          router.navigate(`/p/${slug}`)
        }
      })
    })
  }

  private flashTimer: any = null
  private showFlash(message: string, type: 'success' | 'error' = 'success'): void {
    const flash = this.container.querySelector<HTMLElement>('#dashHeaderFlash')
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

  private renderNotifications(): void {
    const list = this.container.querySelector<HTMLElement>('#notifListContainer')!
    const total = this.pendingProjectInvs.length + this.pendingTeamInvs.length
    if (total === 0) {
      list.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px;">No pending invitations or notifications.</div>`
      return
    }

    const pItems = this.pendingProjectInvs.map((inv) => `
      <div style="background: var(--bg-app); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 10px 14px; font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <b>Project:</b> ${inv.projectName}
          <div style="font-size: 11px; color: var(--text-secondary);">Invited as <span class="badge badge-blue">${inv.role}</span> by ${inv.inviterName}</div>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-ghost btn-reject-proj-inv" data-id="${inv.id}" style="font-size: 11px; padding: 2px 6px;">Reject</button>
          <button class="btn btn-primary btn-accept-proj-inv" data-id="${inv.id}" style="font-size: 11px; padding: 2px 8px;">Accept</button>
        </div>
      </div>
    `).join('')

    const tItems = this.pendingTeamInvs.map((inv) => `
      <div style="background: var(--bg-app); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 10px 14px; font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <b>Team:</b> ${inv.teamName}
          <div style="font-size: 11px; color: var(--text-secondary);">Invited as <span class="badge badge-green">${inv.role}</span> by ${inv.inviterName}</div>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-ghost btn-reject-team-inv" data-id="${inv.id}" style="font-size: 11px; padding: 2px 6px;">Reject</button>
          <button class="btn btn-primary btn-accept-team-inv" data-id="${inv.id}" style="font-size: 11px; padding: 2px 8px;">Accept</button>
        </div>
      </div>
    `).join('')

    list.innerHTML = pItems + tItems

    // Bind project inv buttons
    list.querySelectorAll<HTMLButtonElement>('.btn-accept-proj-inv').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id')!
        try {
          await api.acceptProjectInvitation(id)
          this.showFlash('Project invitation accepted', 'success')
          await this.loadData()
          this.renderNotifications()
        } catch (err: any) {
          this.showFlash(err.message || 'Error accepting project invitation', 'error')
        }
      })
    })

    list.querySelectorAll<HTMLButtonElement>('.btn-reject-proj-inv').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id')!
        try {
          await api.rejectProjectInvitation(id)
          this.showFlash('Project invitation rejected', 'success')
          await this.loadData()
          this.renderNotifications()
        } catch (err: any) {
          this.showFlash(err.message || 'Error rejecting project invitation', 'error')
        }
      })
    })

    // Bind team inv buttons
    list.querySelectorAll<HTMLButtonElement>('.btn-accept-team-inv').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id')!
        try {
          await api.acceptTeamInvitation(id)
          this.showFlash('Team invitation accepted', 'success')
          await this.loadData()
          this.renderNotifications()
        } catch (err: any) {
          this.showFlash(err.message || 'Error accepting team invitation', 'error')
        }
      })
    })

    list.querySelectorAll<HTMLButtonElement>('.btn-reject-team-inv').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id')!
        try {
          await api.rejectTeamInvitation(id)
          this.showFlash('Team invitation rejected', 'success')
          await this.loadData()
          this.renderNotifications()
        } catch (err: any) {
          this.showFlash(err.message || 'Error rejecting team invitation', 'error')
        }
      })
    })
  }

  private bindEvents(): void {
    const btnNew = this.container.querySelector<HTMLButtonElement>('#btnNewProject')!
    const createCard = this.container.querySelector<HTMLElement>('#createProjectCard')!
    const btnCancel = this.container.querySelector<HTMLButtonElement>('#btnCancelCreateProj')!
    const btnSubmit = this.container.querySelector<HTMLButtonElement>('#btnSubmitCreateProj')!
    const inputName = this.container.querySelector<HTMLInputElement>('#inputProjName')!
    const inputSlug = this.container.querySelector<HTMLInputElement>('#inputProjSlug')!
    const inputDesc = this.container.querySelector<HTMLInputElement>('#inputProjDesc')!
    const errorEl = this.container.querySelector<HTMLElement>('#createProjectError')!

    const btnTeams = this.container.querySelector<HTMLButtonElement>('#btnGoTeams')!
    const btnSettings = this.container.querySelector<HTMLButtonElement>('#btnGoSettings')!
    const btnLogout = this.container.querySelector<HTMLButtonElement>('#btnLogoutNav')!
    const btnNotif = this.container.querySelector<HTMLButtonElement>('#btnOpenNotifications')!
    const modalNotif = this.container.querySelector<HTMLDialogElement>('#notifModal')!
    const btnCloseNotif = this.container.querySelector<HTMLButtonElement>('#btnCloseNotifModal')!

    btnTeams.addEventListener('click', () => router.navigate('/teams'))
    btnSettings.addEventListener('click', () => router.navigate('/settings'))
    btnLogout.addEventListener('click', async () => {
      await api.logout()
      router.navigate('/login')
    })

    btnNotif.addEventListener('click', () => {
      this.renderNotifications()
      modalNotif.showModal()
    })
    btnCloseNotif.addEventListener('click', () => modalNotif.close())

    btnNew.addEventListener('click', () => {
      createCard.style.display = 'block'
      inputName.focus()
    })

    btnCancel.addEventListener('click', () => {
      createCard.style.display = 'none'
      errorEl.style.display = 'none'
      inputName.value = ''
      inputSlug.value = ''
      inputDesc.value = ''
    })

    inputName.addEventListener('input', () => {
      if (!inputSlug.dataset.manual) {
        inputSlug.value = inputName.value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
      }
    })

    inputSlug.addEventListener('input', () => {
      inputSlug.dataset.manual = 'true'
    })

    btnSubmit.addEventListener('click', async () => {
      const name = inputName.value.trim()
      const slug = inputSlug.value.trim()
      const description = inputDesc.value.trim()

      if (!name) {
        errorEl.style.display = 'block'
        errorEl.textContent = 'Project name is required'
        return
      }

      try {
        await api.createProject({ name, slug: slug || undefined, description: description || undefined })
        createCard.style.display = 'none'
        inputName.value = ''
        inputSlug.value = ''
        inputDesc.value = ''
        errorEl.style.display = 'none'
        await this.loadData()
      } catch (err: any) {
        errorEl.style.display = 'block'
        errorEl.textContent = err.message || 'Error creating project'
      }
    })
  }
}
