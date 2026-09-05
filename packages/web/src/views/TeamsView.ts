import { api, type UserProfile } from '../services/api'
import { router } from '../router'

export class TeamsView {
  private container: HTMLElement
  private user: UserProfile | null = null
  private teams: any[] = []
  private domainTeams: any[] = []
  private activeTeamDetails: any | null = null

  constructor(container: HTMLElement) {
    this.container = container
  }

  async render(): Promise<void> {
    this.container.innerHTML = `
      <div style="display: flex; height: 100vh; flex-direction: column; background: var(--bg-app);">
        
        <!-- Header -->
        <header style="position: relative; height: var(--header-height); background: var(--bg-surface); border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between; padding: 0 24px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <button id="btnBackFromTeams" class="btn btn-ghost" title="Back to Projects" style="font-size: 14px; padding: 4px 8px;">←</button>
            <span style="font-size: 20px;">👥</span>
            <span style="font-weight: 700; font-size: 16px; color: var(--text-primary);">Teams & Organizations</span>
          </div>

          <!-- Flash Banner in Header (Centered absolutely) -->
          <div id="teamsHeaderFlash" style="display: none; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); align-items: center; gap: 8px; font-size: 12px; font-weight: 500; padding: 6px 16px; border-radius: var(--radius-full); box-shadow: var(--shadow-sm); z-index: 10; pointer-events: none; transition: all 0.2s ease;"></div>

          <button id="btnLogoutTeams" class="btn btn-ghost" style="font-size: 12px;">Sign Out</button>
        </header>

        <!-- Main Body -->
        <main style="flex: 1; overflow-y: auto; padding: 32px 24px; max-width: 900px; width: 100%; margin: 0 auto;">
          
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
            <div>
              <h2 style="font-size: 20px; font-weight: 700; margin: 0 0 4px; color: var(--text-primary);">Your Teams</h2>
              <p style="font-size: 13px; color: var(--text-secondary); margin: 0;">Collaborate with groups across multiple projects.</p>
            </div>
            <button id="btnOpenCreateTeam" class="btn btn-primary">+ Create Private Team</button>
          </div>

          <!-- Create Team Inline Form -->
          <div id="createTeamCard" style="display: none; background: var(--bg-surface); border: 1px solid var(--accent-subtle); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 24px; box-shadow: var(--shadow-sm);">
            <h3 style="font-size: 15px; font-weight: 600; margin: 0 0 12px;">New Private Team</h3>
            <div style="display: flex; gap: 8px;">
              <input id="inputNewTeamName" class="input" type="text" placeholder="e.g. Core Engineering" style="flex: 1;" />
              <button id="btnCancelCreateTeam" class="btn btn-ghost">Cancel</button>
              <button id="btnSubmitCreateTeam" class="btn btn-primary">Create Team</button>
            </div>
          </div>

          <!-- Section 1: Joined Teams Grid -->
          <div id="teamsGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 32px;"></div>

          <!-- Section 2: Available Corporate Domain Teams (Auto-detected) -->
          <section id="domainTeamsSection" style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px; box-shadow: var(--shadow-sm);">
            <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 6px; color: var(--accent-primary);">🏢 Corporate Domain Teams</h3>
            <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 16px;">
              Automatically created for your verified corporate emails. Join to collaborate with everyone in your domain.
            </p>
            <div id="domainTeamsList" style="display: flex; flex-direction: column; gap: 8px;"></div>
          </section>

        </main>
      </div>

      <!-- Team Details & Members Modal -->
      <dialog id="teamDetailsDialog" style="max-width: 540px; width: 90%; border: 1px solid var(--border-default); border-radius: var(--radius-lg); background: var(--bg-surface); color: var(--text-primary); padding: 24px; box-shadow: var(--shadow-lg);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 id="modalTeamTitle" style="margin: 0; font-size: 16px;">Team Details</h3>
          <span id="modalTeamTypeBadge" class="badge badge-blue"></span>
        </div>

        <div id="modalTeamError" style="display: none; padding: 8px 12px; background: var(--danger-bg); color: var(--danger-text); border-radius: var(--radius-md); font-size: 12px; margin-bottom: 12px;"></div>

        <!-- Invite Member (if Admin) -->
        <div id="teamInviteMemberBox" style="margin-bottom: 16px; padding: 12px; background: var(--bg-app); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
          <label style="display: block; font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px;">Invite Member</label>
          <div style="display: flex; gap: 6px;">
            <input id="inputInviteTarget" class="input" type="text" placeholder="@username or email" style="flex: 1; font-size: 12px;" />
            <select id="selectInviteRole" class="input" style="width: 100px; font-size: 12px;">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button id="btnSendInvite" class="btn btn-primary" style="font-size: 12px;">Invite</button>
          </div>
        </div>

        <h4 style="font-size: 13px; font-weight: 600; margin: 0 0 8px;">Members (<span id="modalMemberCount">0</span>)</h4>
        <div id="modalMemberList" style="max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; margin-bottom: 20px;"></div>

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-subtle); padding-top: 16px;">
          <button id="btnLeaveTeamAction" class="btn btn-danger" style="font-size: 12px;">Leave Team</button>
          <button id="btnCloseTeamModal" class="btn btn-ghost">Close</button>
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

      const teamsRes = await api.listTeams()
      this.teams = teamsRes.teams || []
      this.domainTeams = teamsRes.domainTeams || []

      this.renderTeamsGrid()
      this.renderDomainTeams()
    } catch {
      router.navigate('/login')
    }
  }

  private renderTeamsGrid(): void {
    const grid = this.container.querySelector<HTMLElement>('#teamsGrid')!
    if (this.teams.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 32px; background: var(--bg-surface); border: 1px dashed var(--border-default); border-radius: var(--radius-lg); text-align: center; color: var(--text-muted); font-size: 13px;">
          You are not currently a member of any private or corporate teams.
        </div>
      `
      return
    }

    grid.innerHTML = this.teams.map((t) => {
      return `
        <div class="team-card" data-id="${t.id}" style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 18px; cursor: pointer; transition: all 0.15s ease; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <h3 style="font-size: 15px; font-weight: 600; margin: 0; color: var(--text-primary);">${t.name}</h3>
              <span class="badge ${t.type === 'domain' ? 'badge-blue' : 'badge-green'}">${t.type}</span>
            </div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">${t.members?.length || t.memberCount || 1} members</div>
          </div>

          <div style="border-top: 1px solid var(--border-subtle); padding-top: 10px; font-size: 11px; color: var(--accent-primary); font-weight: 500; text-align: right;">
            Manage Team →
          </div>
        </div>
      `
    }).join('')

    grid.querySelectorAll<HTMLElement>('.team-card').forEach((card) => {
      card.addEventListener('click', async () => {
        const id = card.getAttribute('data-id')
        if (id) {
          await this.openTeamDetails(id)
        }
      })
    })
  }

  private renderDomainTeams(): void {
    const list = this.container.querySelector<HTMLElement>('#domainTeamsList')!
    if (this.domainTeams.length === 0) {
      list.innerHTML = `<div style="font-size: 12px; color: var(--text-muted);">No additional domain teams detected for your verified emails.</div>`
      return
    }

    list.innerHTML = this.domainTeams.map((dt) => {
      const isMember = this.teams.some((t) => t.id === dt.id)
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; background: var(--bg-app); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); font-size: 13px;">
          <div>
            <b>${dt.name}</b> <span style="font-size: 11px; color: var(--text-muted);">(${dt.domain})</span>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Domain team for @${dt.domain}</div>
          </div>

          <div>
            ${isMember ? `
              <span class="badge badge-green">Joined</span>
            ` : `
              <button class="btn btn-primary btn-join-domain" data-id="${dt.id}" data-domain="${dt.domain}" style="font-size: 11px; padding: 4px 10px;">Join Team</button>
            `}
          </div>
        </div>
      `
    }).join('')

    list.querySelectorAll<HTMLButtonElement>('.btn-join-domain').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const teamId = btn.getAttribute('data-id')!
        const domain = (btn.getAttribute('data-domain') || '').trim().toLowerCase()
        const matchedEmail = this.user?.emails?.find((e) => {
          const eDomain = e.email.split('@')[1]?.toLowerCase()
          return eDomain === domain && e.verified
        })?.email

        if (!matchedEmail) {
          this.showFlash(`Missing verified @${domain} email. Please add and verify it in Settings first.`, 'error')
          return
        }
        
        try {
          await api.joinDomainTeam(teamId, matchedEmail)
          this.showFlash('Joined corporate team successfully', 'success')
          await this.loadData()
        } catch (err: any) {
          this.showFlash(err.message || 'Error joining domain team', 'error')
        }
      })
    })
  }

  private flashTimer: any = null
  private showFlash(message: string, type: 'success' | 'error' = 'success'): void {
    const flash = this.container.querySelector<HTMLElement>('#teamsHeaderFlash')
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

  private async openTeamDetails(teamId: string): Promise<void> {
    const dialog = this.container.querySelector<HTMLDialogElement>('#teamDetailsDialog')!
    const title = this.container.querySelector<HTMLElement>('#modalTeamTitle')!
    const badge = this.container.querySelector<HTMLElement>('#modalTeamTypeBadge')!
    const memberCount = this.container.querySelector<HTMLElement>('#modalMemberCount')!
    const memberList = this.container.querySelector<HTMLElement>('#modalMemberList')!
    const inviteBox = this.container.querySelector<HTMLElement>('#teamInviteMemberBox')!

    try {
      const res = await api.getTeamDetails(teamId)
      this.activeTeamDetails = res.team
      title.textContent = this.activeTeamDetails.name
      badge.textContent = this.activeTeamDetails.type
      memberCount.textContent = String(this.activeTeamDetails.members?.length || 0)

      inviteBox.style.display = this.activeTeamDetails.type === 'private' ? 'block' : 'none'

      memberList.innerHTML = (this.activeTeamDetails.members || []).map((m: any) => {
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: var(--bg-app); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); font-size: 12px;">
            <div>
              <b>@${m.username || m.userId}</b>
              <span style="font-size: 10px; color: var(--text-muted); margin-left: 4px;">(${m.role})</span>
            </div>
          </div>
        `
      }).join('')

      dialog.showModal()
    } catch (err: any) {
      this.showFlash(err.message || 'Error loading team details', 'error')
    }
  }

  private bindEvents(): void {
    const btnBack = this.container.querySelector<HTMLButtonElement>('#btnBackFromTeams')!
    const btnLogout = this.container.querySelector<HTMLButtonElement>('#btnLogoutTeams')!
    const btnOpenCreate = this.container.querySelector<HTMLButtonElement>('#btnOpenCreateTeam')!
    const createCard = this.container.querySelector<HTMLElement>('#createTeamCard')!
    const btnCancelCreate = this.container.querySelector<HTMLButtonElement>('#btnCancelCreateTeam')!
    const btnSubmitCreate = this.container.querySelector<HTMLButtonElement>('#btnSubmitCreateTeam')!
    const inputTeamName = this.container.querySelector<HTMLInputElement>('#inputNewTeamName')!

    const dialog = this.container.querySelector<HTMLDialogElement>('#teamDetailsDialog')!
    const btnCloseModal = this.container.querySelector<HTMLButtonElement>('#btnCloseTeamModal')!
    const btnLeaveTeam = this.container.querySelector<HTMLButtonElement>('#btnLeaveTeamAction')!
    const btnSendInvite = this.container.querySelector<HTMLButtonElement>('#btnSendInvite')!
    const inputInvite = this.container.querySelector<HTMLInputElement>('#inputInviteTarget')!
    const selectRole = this.container.querySelector<HTMLSelectElement>('#selectInviteRole')!

    btnBack.addEventListener('click', () => router.navigate('/projects'))
    btnLogout.addEventListener('click', async () => {
      await api.logout()
      router.navigate('/login')
    })

    btnOpenCreate.addEventListener('click', () => {
      createCard.style.display = 'block'
      inputTeamName.focus()
    })

    btnCancelCreate.addEventListener('click', () => {
      createCard.style.display = 'none'
      inputTeamName.value = ''
    })

    btnSubmitCreate.addEventListener('click', async () => {
      const name = inputTeamName.value.trim()
      if (!name) return
      try {
        await api.createTeam(name)
        createCard.style.display = 'none'
        inputTeamName.value = ''
        this.showFlash('Team created successfully', 'success')
        await this.loadData()
      } catch (err: any) {
        this.showFlash(err.message || 'Error creating team', 'error')
      }
    })

    btnCloseModal.addEventListener('click', () => dialog.close())

    btnLeaveTeam.addEventListener('click', async () => {
      if (!this.activeTeamDetails) return
      if (!confirm(`Are you sure you want to leave ${this.activeTeamDetails.name}?`)) return
      try {
        await api.leaveTeam(this.activeTeamDetails.id)
        dialog.close()
        this.showFlash('Left team successfully', 'success')
        await this.loadData()
      } catch (err: any) {
        this.showFlash(err.message || 'Error leaving team', 'error')
      }
    })

    btnSendInvite.addEventListener('click', async () => {
      if (!this.activeTeamDetails) return
      const target = inputInvite.value.trim()
      const role = selectRole.value as 'admin' | 'member'
      if (!target) return
      try {
        await api.inviteTeamMember(this.activeTeamDetails.id, target, role)
        inputInvite.value = ''
        this.showFlash('Invitation sent successfully', 'success')
        await this.openTeamDetails(this.activeTeamDetails.id)
      } catch (err: any) {
        this.showFlash(err.message || 'Error sending invitation', 'error')
      }
    })
  }
}
