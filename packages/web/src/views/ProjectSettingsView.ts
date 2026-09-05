import { api, type UserProfile } from '../services/api'
import { router } from '../router'

export class ProjectSettingsView {
  private container: HTMLElement
  private projectSlug: string
  private user: UserProfile | null = null
  private project: any | null = null
  private availableTeams: any[] = []
  private authorizedAgents: any[] = []

  constructor(container: HTMLElement, projectSlug: string) {
    this.container = container
    this.projectSlug = projectSlug
  }

  async render(): Promise<void> {
    this.container.innerHTML = `
      <div style="display: flex; height: 100vh; flex-direction: column; background: var(--bg-app);">
        
        <!-- Header -->
        <header style="position: relative; height: var(--header-height); background: var(--bg-surface); border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between; padding: 0 24px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <button id="btnBackToWorkspace" class="btn btn-ghost" title="Back to Workspace" style="font-size: 14px; padding: 4px 8px;">←</button>
            <span style="font-size: 20px;">👥</span>
            <div>
              <span id="projSettingName" style="font-weight: 700; font-size: 15px; color: var(--text-primary);">Share & Settings</span>
              <span id="projSettingSlug" style="font-size: 12px; color: var(--text-muted); margin-left: 6px;"></span>
            </div>
          </div>

          <!-- Flash Banner in Header (Centered absolutely) -->
          <div id="projHeaderFlash" style="display: none; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); align-items: center; gap: 8px; font-size: 12px; font-weight: 500; padding: 6px 16px; border-radius: var(--radius-full); box-shadow: var(--shadow-sm); z-index: 10; pointer-events: none; transition: all 0.2s ease;"></div>
        </header>

        <!-- Main Body -->
        <main style="flex: 1; overflow-y: auto; padding: 32px 24px; max-width: 800px; width: 100%; margin: 0 auto;">

          <!-- Section 1: Git Contextual Signature Email -->
          <section style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 24px; box-shadow: var(--shadow-sm);">
            <h3 style="font-size: 15px; font-weight: 700; margin: 0 0 6px;">Git Author Signature</h3>
            <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 12px;">
              Select which verified email address signs your Git commits and document publications in this repository.
            </p>
            
            <div style="display: flex; gap: 8px; align-items: center;">
              <select id="selectContextEmail" class="input" style="flex: 1; font-size: 13px;"></select>
              <button id="btnUpdateContextEmail" class="btn btn-primary">Update Signature</button>
            </div>
          </section>

          <!-- Section 2: Direct Project Members -->
          <section style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 24px; box-shadow: var(--shadow-sm);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <div>
                <h3 style="font-size: 15px; font-weight: 700; margin: 0 0 4px;">Direct Project Members</h3>
                <p style="font-size: 12px; color: var(--text-secondary); margin: 0;">Invite individual users directly to this repository.</p>
              </div>
            </div>

            <!-- Invite Direct Member Box (Owner Only) -->
            <div id="inviteMemberRow" style="display: flex; gap: 6px; margin: 16px 0;">
              <input id="inputProjectInviteTarget" class="input" type="text" placeholder="@username or email" style="flex: 1; font-size: 12px;" />
              <select id="selectProjectInviteRole" class="input" style="width: 120px; font-size: 12px;">
                <option value="editor">Editor</option>
                <option value="commenter">Commenter</option>
                <option value="viewer">Viewer</option>
                <option value="owner">Owner</option>
              </select>
              <button id="btnSendProjectInvite" class="btn btn-primary" style="font-size: 12px;">Invite</button>
            </div>

            <div id="projectMembersList" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px;"></div>
          </section>

          <!-- Section 3: Assigned Teams & Organizations -->
          <section style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 24px; box-shadow: var(--shadow-sm);">
            <h3 style="font-size: 15px; font-weight: 700; margin: 0 0 6px;">Assigned Teams</h3>
            <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 12px;">
              Grant repository access to all members of a private or corporate domain team.
            </p>

            <div id="assignTeamRow" style="display: flex; gap: 6px; margin-bottom: 16px;">
              <select id="selectAssignTeam" class="input" style="flex: 1; font-size: 12px;"></select>
              <select id="selectAssignTeamRole" class="input" style="width: 120px; font-size: 12px;">
                <option value="editor">Editor</option>
                <option value="commenter">Commenter</option>
                <option value="viewer">Viewer</option>
              </select>
              <button id="btnAssignTeam" class="btn btn-primary" style="font-size: 12px;">Assign Team</button>
            </div>

            <div id="projectAssignedTeamsList" style="display: flex; flex-direction: column; gap: 8px;"></div>
          </section>

          <!-- Section 4: Authorized AI Agents (MCP) -->
          <section style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 24px; box-shadow: var(--shadow-sm);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div>
                <h3 style="font-size: 15px; font-weight: 700; margin: 0 0 4px; color: var(--accent-primary);">🤖 Authorized AI Agents (MCP)</h3>
                <p style="font-size: 12px; color: var(--text-secondary); margin: 0;">Agents authorized to read, edit, or comment on this repository via MCP.</p>
              </div>
            </div>

            <div id="projectAgentsList" style="display: flex; flex-direction: column; gap: 8px;"></div>
          </section>

          <!-- Section 5: Leave Project (Danger Zone) -->
          <section style="background: var(--bg-surface); border: 1px solid var(--danger-border); border-radius: var(--radius-lg); padding: 24px; box-shadow: var(--shadow-sm);">
            <h3 style="font-size: 15px; font-weight: 700; margin: 0 0 4px; color: var(--danger-text);">Danger Zone</h3>
            <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 12px;">
              Leaving this project will remove your direct membership and editing rights.
            </p>
            <button id="btnLeaveProjectAction" class="btn btn-danger" style="font-size: 12px;">Leave Project</button>
          </section>

        </main>

        <!-- Remove Member OTP Re-verification Dialog -->
        <dialog id="removeMemberOtpDialog" style="border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px; background: var(--bg-surface); color: var(--text-primary); max-width: 440px; width: 100%; box-shadow: var(--shadow-lg);">
          <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 8px;">Remove Member</h3>
          <p id="removeMemberModalDesc" style="font-size: 13px; color: var(--text-secondary); margin: 0 0 16px; line-height: 1.4;">
            To confirm removing member <b id="removeMemberTargetName"></b> from this repository, enter the verification code sent to your email.
          </p>

          <div style="display: flex; flex-direction: column; gap: 12px;">
            <input id="inputRemoveMemberOtp" class="input" type="text" placeholder="6-digit verification code" style="font-size: 14px; text-align: center; letter-spacing: 2px;" maxlength="6" />
            
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
              <button id="btnCancelRemoveMemberOtp" class="btn btn-ghost" style="font-size: 12px;">Cancel</button>
              <button id="btnConfirmRemoveMemberOtp" class="btn btn-danger" style="font-size: 12px;">Confirm Removal</button>
            </div>
          </div>
        </dialog>
      </div>
    `

    this.bindEvents()
    await this.loadData()
  }

  private async loadData(): Promise<void> {
    try {
      const meRes = await api.getMe()
      this.user = meRes.user

      const projsRes = await api.listProjects()
      const currentProj = projsRes.projects.find((p) => p.slug === this.projectSlug)
      if (!currentProj) {
        router.navigate('/projects')
        return
      }

      const detailsRes = await api.getProjectDetails(currentProj.id)
      this.project = detailsRes.project

      const teamsRes = await api.listTeams()
      this.availableTeams = teamsRes.teams || []

      const agentsRes = await api.listAgentSessions().catch(() => ({ sessions: [] }))
      this.authorizedAgents = (agentsRes.sessions || []).filter((s: any) =>
        s.projectScopes?.some((scope: any) => scope.projectId === this.project.id || scope.projectId === '*')
      )

      this.renderDetails()
    } catch {
      router.navigate('/login')
    }
  }

  private flashTimer: any = null
  private showFlash(message: string, type: 'success' | 'error' = 'success'): void {
    const flash = this.container.querySelector<HTMLElement>('#projHeaderFlash')
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

  private pendingRemoveUserId: string | null = null

  private renderDetails(): void {
    const nameEl = this.container.querySelector<HTMLElement>('#projSettingName')!
    const slugEl = this.container.querySelector<HTMLElement>('#projSettingSlug')!

    nameEl.textContent = `Share & Settings: ${this.project.name}`
    slugEl.textContent = `(${this.project.slug})`

    const isOwner = this.project.effectiveRole === 'owner'

    // Owner UI Gating: Hide Invite & Team Assignment controls for non-owners
    const inviteRow = this.container.querySelector<HTMLElement>('#inviteMemberRow')!
    if (inviteRow) {
      inviteRow.style.display = isOwner ? 'flex' : 'none'
    }

    const assignTeamRow = this.container.querySelector<HTMLElement>('#assignTeamRow')!
    if (assignTeamRow) {
      assignTeamRow.style.display = isOwner ? 'flex' : 'none'
    }

    // Render Context Email Select
    const selectEmail = this.container.querySelector<HTMLSelectElement>('#selectContextEmail')!
    if (this.user?.emails) {
      selectEmail.innerHTML = this.user.emails.map((e) => {
        const isSelected = e.email === this.project.currentContextEmail
        return `<option value="${e.email}" ${isSelected ? 'selected' : ''}>${e.email} ${e.primary ? '(Primary)' : ''}</option>`
      }).join('')
    }

    // Render Direct Members & Pending Invitations (Current user always sorted first)
    const membersList = this.container.querySelector<HTMLElement>('#projectMembersList')!
    const sortedMembers = [...(this.project.members || [])].sort((a: any, b: any) => {
      if (a.userId === this.user?.id) return -1
      if (b.userId === this.user?.id) return 1
      return 0
    })

    const membersHtml = sortedMembers.map((m: any) => {
      const isSelf = m.userId === this.user?.id
      const roleBadgeClass = m.role === 'owner' || m.role === 'editor' ? 'badge-blue' : m.role === 'commenter' ? 'badge-orange' : 'badge-green'
      const canRemove = isOwner && !isSelf
      const cardBorder = isSelf
        ? 'border: 1.5px solid var(--accent-primary, #10b981); box-shadow: 0 0 0 1px var(--success-border, rgba(16, 185, 129, 0.2));'
        : 'border: 1px solid var(--border-subtle);'
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--bg-app); ${cardBorder} border-radius: var(--radius-md); font-size: 13px;">
          <div>
            <b>@${m.username || m.userId}</b>
            <span style="font-size: 11px; color: var(--text-muted); margin-left: 4px;">(${m.contextEmail || ''})</span>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Role: <span class="badge ${roleBadgeClass}">${m.role}</span></div>
          </div>
          ${canRemove ? `
            <button class="btn btn-danger btn-remove-member" data-user-id="${m.userId}" data-username="${m.username || m.userId}" style="font-size: 11px; padding: 3px 8px;">Remove Member</button>
          ` : ''}
        </div>
      `
    }).join('')

    const pendingHtml = (this.project.pendingInvitations || []).map((inv: any) => {
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--bg-app); border: 1px dashed var(--border-subtle); border-radius: var(--radius-md); font-size: 13px;">
          <div>
            <b>${inv.targetEmail || ('@' + inv.targetUsername)}</b> <span class="badge badge-orange">Pending</span>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Role: <span class="badge badge-blue">${inv.role}</span> (Expires ${inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : 'soon'})</div>
          </div>
          ${isOwner ? `
            <button class="btn btn-danger btn-revoke-invite" data-id="${inv.id}" style="font-size: 11px; padding: 3px 8px;">Revoke</button>
          ` : ''}
        </div>
      `
    }).join('')

    membersList.innerHTML = membersHtml + (pendingHtml ? `<div style="margin-top: 6px; font-size: 12px; font-weight: 600; color: var(--text-muted);">Pending Invitations</div>` + pendingHtml : '')

    // Bind Revoke Invitations
    membersList.querySelectorAll<HTMLButtonElement>('.btn-revoke-invite').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const inviteId = btn.getAttribute('data-id')!
        try {
          await api.revokeProjectInvitation(this.project.id, inviteId)
          this.showFlash('Invitation revoked', 'success')
          await this.loadData()
        } catch (err: any) {
          this.showFlash(err.message || 'Error revoking invitation', 'error')
        }
      })
    })

    // Bind Member Removal & Revocation
    membersList.querySelectorAll<HTMLButtonElement>('.btn-remove-member').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const targetUserId = btn.getAttribute('data-user-id')!
        const targetUsername = btn.getAttribute('data-username')!
        await this.openRemoveMemberDialog(targetUserId, targetUsername)
      })
    })

    // Render Assigned Teams
    const teamsList = this.container.querySelector<HTMLElement>('#projectAssignedTeamsList')!
    if (!this.project.teams || this.project.teams.length === 0) {
      teamsList.innerHTML = `<div style="font-size: 12px; color: var(--text-muted);">No teams currently assigned to this project.</div>`
    } else {
      teamsList.innerHTML = this.project.teams.map((t: any) => {
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--bg-app); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); font-size: 13px;">
            <div>
              <b>👥 ${t.teamName}</b>
              <span style="font-size: 11px; color: var(--text-muted); margin-left: 4px;">(${t.teamType})</span>
              <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Assigned Role: <span class="badge badge-blue">${t.role}</span></div>
            </div>
            ${isOwner ? `
              <button class="btn btn-danger btn-remove-proj-team" data-id="${t.teamId}" style="font-size: 11px; padding: 3px 8px;">Remove Team</button>
            ` : ''}
          </div>
        `
      }).join('')

      teamsList.querySelectorAll<HTMLButtonElement>('.btn-remove-proj-team').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const teamId = btn.getAttribute('data-id')!
          try {
            await api.removeProjectTeam(this.project.id, teamId)
            this.showFlash('Team removed from project', 'success')
            await this.loadData()
          } catch (err: any) {
            this.showFlash(err.message || 'Error removing team from project', 'error')
          }
        })
      })
    }

    // Populate Available Teams Dropdown
    const selectAssign = this.container.querySelector<HTMLSelectElement>('#selectAssignTeam')!
    if (this.availableTeams.length === 0) {
      selectAssign.innerHTML = `<option value="">No teams available to assign</option>`
    } else {
      selectAssign.innerHTML = this.availableTeams.map((t) => `<option value="${t.id}">${t.name} (${t.type})</option>`).join('')
    }

    // Render Authorized AI Agents
    const agentsList = this.container.querySelector<HTMLElement>('#projectAgentsList')!
    if (this.authorizedAgents.length === 0) {
      agentsList.innerHTML = `<div style="font-size: 12px; color: var(--text-muted);">No AI agent sessions authorized for this project.</div>`
    } else {
      agentsList.innerHTML = this.authorizedAgents.map((agent: any) => {
        const scope = agent.projectScopes?.find((s: any) => s.projectId === this.project.id || s.projectId === '*')
        const delegator = agent.userId === this.user?.id ? (this.user?.username ? `@${this.user.username}` : 'You') : (agent.username ? `@${agent.username}` : agent.userId)
        const canRevokeAgent = isOwner || agent.userId === this.user?.id
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--bg-app); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); font-size: 13px;">
            <div>
              <b>🤖 ${agent.agentName}</b> <span style="font-size: 11px; color: var(--text-muted);">(Delegated by <b>${delegator}</b> | Session: ${agent.tokenPrefix || '...'})</span>
              <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Max Role: <span class="badge badge-blue">${scope?.maxRole || 'editor'}</span></div>
            </div>
            ${canRevokeAgent ? `
              <button class="btn btn-danger btn-revoke-agent" data-id="${agent.id}" style="font-size: 11px; padding: 3px 8px;">Revoke Access</button>
            ` : ''}
          </div>
        `
      }).join('')

      agentsList.querySelectorAll<HTMLButtonElement>('.btn-revoke-agent').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const agentId = btn.getAttribute('data-id')!
          try {
            await api.revokeAgentSession(agentId)
            this.showFlash('Agent session revoked', 'success')
            await this.loadData()
          } catch (err: any) {
            this.showFlash(err.message || 'Error revoking agent access', 'error')
          }
        })
      })
    }
  }

  private async openRemoveMemberDialog(targetUserId: string, targetUsername: string): Promise<void> {
    const dialog = this.container.querySelector<HTMLDialogElement>('#removeMemberOtpDialog')!
    const targetNameEl = this.container.querySelector<HTMLElement>('#removeMemberTargetName')!
    const inputOtp = this.container.querySelector<HTMLInputElement>('#inputRemoveMemberOtp')!

    this.pendingRemoveUserId = targetUserId
    targetNameEl.textContent = `@${targetUsername}`
    inputOtp.value = ''

    // Request verification OTP for remove_project_member operation
    try {
      const email = this.user?.defaultEmail || this.user?.emails?.[0]?.email
      if (!email) {
        this.showFlash('No verified email address found on your account', 'error')
        return
      }
      await api.requestCode({ identifier: email, purpose: 'remove_project_member' })
      this.showFlash(`Verification code sent to ${email}`, 'success')
      dialog.showModal()
      inputOtp.focus()
    } catch (err: any) {
      this.showFlash(err.message || 'Error requesting verification code', 'error')
    }
  }

  private bindEvents(): void {
    const btnBack = this.container.querySelector<HTMLButtonElement>('#btnBackToWorkspace')!
    const btnUpdateEmail = this.container.querySelector<HTMLButtonElement>('#btnUpdateContextEmail')!
    const selectEmail = this.container.querySelector<HTMLSelectElement>('#selectContextEmail')!

    const btnInvite = this.container.querySelector<HTMLButtonElement>('#btnSendProjectInvite')!
    const inputInvite = this.container.querySelector<HTMLInputElement>('#inputProjectInviteTarget')!
    const selectInviteRole = this.container.querySelector<HTMLSelectElement>('#selectProjectInviteRole')!

    const btnAssign = this.container.querySelector<HTMLButtonElement>('#btnAssignTeam')!
    const selectAssignTeam = this.container.querySelector<HTMLSelectElement>('#selectAssignTeam')!
    const selectAssignRole = this.container.querySelector<HTMLSelectElement>('#selectAssignTeamRole')!

    const btnLeave = this.container.querySelector<HTMLButtonElement>('#btnLeaveProjectAction')!

    const dialog = this.container.querySelector<HTMLDialogElement>('#removeMemberOtpDialog')!
    const btnCancelOtp = this.container.querySelector<HTMLButtonElement>('#btnCancelRemoveMemberOtp')!
    const btnConfirmOtp = this.container.querySelector<HTMLButtonElement>('#btnConfirmRemoveMemberOtp')!
    const inputOtp = this.container.querySelector<HTMLInputElement>('#inputRemoveMemberOtp')!

    btnBack.addEventListener('click', () => router.navigate(`/p/${this.projectSlug}`))

    btnUpdateEmail.addEventListener('click', async () => {
      const email = selectEmail.value
      try {
        await api.updateProjectContextEmail(this.project.id, email)
        this.showFlash('Git signature email updated', 'success')
        await this.loadData()
      } catch (err: any) {
        this.showFlash(err.message || 'Error updating contextual email', 'error')
      }
    })

    btnInvite.addEventListener('click', async () => {
      const target = inputInvite.value.trim()
      const role = selectInviteRole.value
      if (!target) return
      try {
        await api.inviteProjectMember(this.project.id, target, role)
        inputInvite.value = ''
        this.showFlash('Invitation sent successfully', 'success')
        await this.loadData()
      } catch (err: any) {
        this.showFlash(err.message || 'Error inviting member', 'error')
      }
    })

    btnAssign.addEventListener('click', async () => {
      const teamId = selectAssignTeam.value
      const role = selectAssignRole.value
      if (!teamId) return
      try {
        await api.assignProjectTeam(this.project.id, teamId, role)
        this.showFlash('Team assigned to project', 'success')
        await this.loadData()
      } catch (err: any) {
        this.showFlash(err.message || 'Error assigning team', 'error')
      }
    })

    btnLeave.addEventListener('click', async () => {
      if (!confirm(`Are you sure you want to leave ${this.project.name}?`)) return
      try {
        await api.leaveProject(this.project.id)
        router.navigate('/projects')
      } catch (err: any) {
        this.showFlash(err.message || 'Error leaving project', 'error')
      }
    })

    btnCancelOtp.addEventListener('click', () => {
      dialog.close()
      this.pendingRemoveUserId = null
      inputOtp.value = ''
    })

    btnConfirmOtp.addEventListener('click', async () => {
      const code = inputOtp.value.trim()
      if (!code || !this.pendingRemoveUserId) {
        this.showFlash('Please enter the 6-digit verification code', 'error')
        return
      }

      try {
        await api.removeProjectMember(this.project.id, this.pendingRemoveUserId, code)
        dialog.close()
        this.pendingRemoveUserId = null
        inputOtp.value = ''
        this.showFlash('Member removed from project successfully', 'success')
        await this.loadData()
      } catch (err: any) {
        this.showFlash(err.message || 'Error removing member', 'error')
      }
    })
  }
}

