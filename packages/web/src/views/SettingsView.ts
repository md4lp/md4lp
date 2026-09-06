import { api, type UserProfile } from '../services/api'
import { router } from '../router'
import { themeManager, type ThemeMode } from '../services/theme'
import { i18n, type SupportedLocale } from '../services/i18n'
import { HeaderNav } from '../services/headerNav'

export class SettingsView {
  private container: HTMLElement
  private user: UserProfile | null = null
  private agentSessions: any[] = []
  private projectsMap: Map<string, any> = new Map()
  private headerNav: HeaderNav | null = null

  constructor(container: HTMLElement) {
    this.container = container
  }

  async render(): Promise<void> {
    const currentTheme = themeManager.getTheme()
    const currentLocale = i18n.getLocale()
    const t = i18n.t

    this.headerNav = new HeaderNav(this.container, {
      showProjectsLink: true,
      showBack: true,
      backTitle: t.settings.backTooltip,
      viewLabel: t.settings.title,
      flashId: 'settingsHeaderFlash',
    })

    this.container.innerHTML = `
      <div style="display: flex; height: 100vh; flex-direction: column; background: var(--bg-app);">
        
        <!-- Header -->
        ${this.headerNav.render()}

        <!-- Main Body -->
        <main style="flex: 1; overflow-y: auto; padding: 32px 24px; max-width: 800px; width: 100%; margin: 0 auto;">

          <!-- Section 0: Appearance / Theme Preference -->
          <section style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 24px; box-shadow: var(--shadow-sm);">
            <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 6px;">${t.settings.appearanceTitle}</h3>
            <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 16px;">
              ${t.settings.appearanceDesc}
            </p>

            <div style="display: flex; gap: 12px; margin-bottom: 24px;">
              <label style="flex: 1; display: flex; align-items: center; gap: 8px; padding: 12px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; background: var(--bg-app);">
                <input type="radio" name="themeOption" value="system" ${currentTheme === 'system' ? 'checked' : ''} />
                <div>
                  <div style="font-size: 13px; font-weight: 600;">${t.settings.themeSystem}</div>
                  <div style="font-size: 11px; color: var(--text-muted);">${t.settings.themeSystemDesc}</div>
                </div>
              </label>

              <label style="flex: 1; display: flex; align-items: center; gap: 8px; padding: 12px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; background: var(--bg-app);">
                <input type="radio" name="themeOption" value="light" ${currentTheme === 'light' ? 'checked' : ''} />
                <div>
                  <div style="font-size: 13px; font-weight: 600;">${t.settings.themeLight}</div>
                  <div style="font-size: 11px; color: var(--text-muted);">${t.settings.themeLightDesc}</div>
                </div>
              </label>

              <label style="flex: 1; display: flex; align-items: center; gap: 8px; padding: 12px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; background: var(--bg-app);">
                <input type="radio" name="themeOption" value="dark" ${currentTheme === 'dark' ? 'checked' : ''} />
                <div>
                  <div style="font-size: 13px; font-weight: 600;">${t.settings.themeDark}</div>
                  <div style="font-size: 11px; color: var(--text-muted);">${t.settings.themeDarkDesc}</div>
                </div>
              </label>
            </div>

            <!-- Language Sub-section -->
            <div style="border-top: 1px solid var(--border-subtle); padding-top: 18px;">
              <h4 style="font-size: 14px; font-weight: 700; margin: 0 0 4px;">${t.settings.languageTitle}</h4>
              <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 14px;">
                ${t.settings.languageDesc}
              </p>

              <div style="display: flex; gap: 12px;">
                <label style="flex: 1; display: flex; align-items: center; gap: 8px; padding: 12px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; background: var(--bg-app);">
                  <input type="radio" name="langOption" value="en" ${currentLocale === 'en' ? 'checked' : ''} />
                  <div>
                    <div style="font-size: 13px; font-weight: 600;">${t.settings.langEn}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">${t.settings.langEnDesc}</div>
                  </div>
                </label>

                <label style="flex: 1; display: flex; align-items: center; gap: 8px; padding: 12px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; background: var(--bg-app);">
                  <input type="radio" name="langOption" value="es" ${currentLocale === 'es' ? 'checked' : ''} />
                  <div>
                    <div style="font-size: 13px; font-weight: 600;">${t.settings.langEs}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">${t.settings.langEsDesc}</div>
                  </div>
                </label>
              </div>
            </div>
          </section>

          <!-- Section 1: Profile Details -->
          <section style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 24px; box-shadow: var(--shadow-sm);">
            <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 16px;">${t.settings.profileTitle}</h3>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
              <div>
                <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px;">${t.settings.displayName}</label>
                <input id="inputProfileName" class="input" type="text" />
              </div>
              <div>
                <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px;">${t.settings.username}</label>
                <input id="inputProfileUsername" class="input" type="text" />
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end;">
              <button id="btnSaveProfileInfo" class="btn btn-primary">${t.settings.saveProfile}</button>
            </div>
          </section>

          <!-- Section 2: Verified Email Addresses -->
          <section style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 24px; box-shadow: var(--shadow-sm);">
            <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 16px;">${t.settings.verifiedEmailsTitle}</h3>
            <div id="emailsListContainer" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;"></div>

            <!-- Add Email Input Inline -->
            <div style="border-top: 1px solid var(--border-subtle); padding-top: 16px;">
              <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">${t.settings.addEmail}</label>
              <div style="display: flex; gap: 8px;">
                <input id="inputNewEmail" class="input" type="email" placeholder="secondary@work.com" style="flex: 1;" />
                <button id="btnAddEmail" class="btn btn-primary">${t.settings.sendOtp}</button>
              </div>

              <div id="verifyNewEmailRow" style="display: none; margin-top: 12px; background: var(--bg-app); border: 1px solid var(--border-subtle); padding: 12px; border-radius: var(--radius-md);">
                <div id="newEmailDevHelper" style="display: none; font-size: 11px; color: var(--warning-text); margin-bottom: 6px;"></div>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <input id="inputNewEmailCode" class="input" type="text" placeholder="6-digit code" maxlength="6" style="width: 140px; text-align: center; font-weight: 700;" />
                  <button id="btnConfirmVerifyEmail" class="btn btn-primary" style="font-size: 12px;">${t.settings.confirmEmail}</button>
                </div>
              </div>
            </div>
          </section>

          <!-- Section 3: Connected AI Agents & MCP Sessions -->
          <section style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 24px; box-shadow: var(--shadow-sm);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
              <div>
                <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 4px; color: var(--accent-primary);">🤖 ${t.settings.agentTokensTitle}</h3>
                <p style="font-size: 12px; color: var(--text-secondary); margin: 0;">${t.settings.agentTokensDesc}</p>
              </div>
            </div>

            <div id="agentSessionsContainer" style="display: flex; flex-direction: column; gap: 8px;"></div>
          </section>

        </main>
      </div>
    `

    this.bindEvents()
    await this.loadData()
  }

  private async loadData(): Promise<void> {
    try {
      const meRes = await api.getMe()
      this.user = meRes.user

      if (this.headerNav && this.user) {
        this.headerNav.setUser(this.user, 0)
      }

      const inputName = this.container.querySelector<HTMLInputElement>('#inputProfileName')!
      const inputUsername = this.container.querySelector<HTMLInputElement>('#inputProfileUsername')!
      inputName.value = this.user.name || ''
      inputUsername.value = this.user.username || ''

      this.renderEmails()

      const [projectsRes, sessionsRes] = await Promise.all([
        api.listProjects().catch(() => ({ projects: [] })),
        api.listAgentSessions().catch(() => ({ sessions: [] })),
      ])

      this.projectsMap.clear()
      for (const p of projectsRes.projects || []) {
        this.projectsMap.set(p.id, p)
      }

      this.agentSessions = sessionsRes.sessions || []
      this.renderAgentSessions()
    } catch {
      router.navigate('/login')
    }
  }

  private flashTimer: any = null
  private showFlash(message: string, type: 'success' | 'error' = 'success'): void {
    const flash = this.container.querySelector<HTMLElement>('#settingsHeaderFlash')
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

  private renderEmails(): void {
    const container = this.container.querySelector<HTMLElement>('#emailsListContainer')!
    if (!this.user?.emails) return

    container.innerHTML = this.user.emails.map((e) => {
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-app); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); font-size: 13px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 500;">${e.email}</span>
            ${e.primary ? '<span class="badge badge-green">Primary</span>' : ''}
          </div>

          <div style="display: flex; gap: 8px;">
            ${!e.primary ? `
              <button class="btn btn-ghost btn-set-primary" data-email="${e.email}" style="font-size: 11px; padding: 3px 8px;">Set Primary</button>
              <button class="btn btn-danger btn-remove-email" data-email="${e.email}" style="font-size: 11px; padding: 3px 8px;">Remove</button>
            ` : ''}
          </div>
        </div>
      `
    }).join('')

    container.querySelectorAll<HTMLButtonElement>('.btn-set-primary').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const email = btn.getAttribute('data-email')!
        try {
          await api.setPrimaryEmail(email)
          this.showFlash('Primary email updated', 'success')
          await this.loadData()
        } catch (err: any) {
          this.showFlash(err.message || 'Error setting primary email', 'error')
        }
      })
    })

    container.querySelectorAll<HTMLButtonElement>('.btn-remove-email').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const email = btn.getAttribute('data-email')!
        if (!confirm(`Are you sure you want to remove ${email}?`)) return
        try {
          await api.removeEmail(email)
          this.showFlash('Email removed', 'success')
          await this.loadData()
        } catch (err: any) {
          this.showFlash(err.message || 'Error removing email', 'error')
        }
      })
    })
  }

  private renderAgentSessions(): void {
    const container = this.container.querySelector<HTMLElement>('#agentSessionsContainer')!
    if (this.agentSessions.length === 0) {
      container.innerHTML = `<div style="font-size: 12px; color: var(--text-muted);">No active AI agent sessions authorized.</div>`
      return
    }

    container.innerHTML = this.agentSessions.map((s) => {
      const expiresDate = new Date(s.absoluteExpiresAt).toLocaleString()
      const idleDate = s.idleExpiresAt ? new Date(s.idleExpiresAt).toLocaleTimeString() : 'N/A'
      const scopeBadges = (s.projectScopes || []).map((sc: any) => {
        const proj = this.projectsMap.get(sc.projectId)
        const name = proj ? proj.name : sc.projectId
        const roleColor = sc.maxRole === 'editor' ? 'badge-blue' : sc.maxRole === 'commenter' ? 'badge-orange' : 'badge-green'
        return `<b>${name}</b> <span class="badge ${roleColor}" style="font-size: 10px; margin-left: 2px;">${sc.maxRole}</span>`
      }).join(', ')

      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; background: var(--bg-app); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); font-size: 13px;">
          <div>
            <div style="font-weight: 600; color: var(--text-primary);">🤖 ${s.agentName} <span style="font-weight: 400; font-size: 11px; color: var(--text-muted);">(Token: ${s.tokenPrefix}...)</span></div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">Projects: ${scopeBadges || '<b>Global</b>'}</div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Expires: ${expiresDate} | Idle timeout: ${idleDate}</div>
          </div>

          <button class="btn btn-danger btn-revoke-session" data-id="${s.id}" style="font-size: 11px; padding: 4px 10px;">Revoke</button>
        </div>
      `
    }).join('')

    container.querySelectorAll<HTMLButtonElement>('.btn-revoke-session').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id')!
        if (!confirm('Revoke this agent session? It will immediately lose access.')) return
        try {
          await api.revokeAgentSession(id)
          this.showFlash('Agent session revoked', 'success')
          await this.loadData()
        } catch (err: any) {
          this.showFlash(err.message || 'Error revoking agent session', 'error')
        }
      })
    })
  }

  private bindEvents(): void {
    if (this.headerNav) {
      this.headerNav.bindEvents(() => {
        this.render()
      })
    }

    const btnSaveProfile = this.container.querySelector<HTMLButtonElement>('#btnSaveProfileInfo')!
    const inputName = this.container.querySelector<HTMLInputElement>('#inputProfileName')!
    const inputUsername = this.container.querySelector<HTMLInputElement>('#inputProfileUsername')!

    const inputNewEmail = this.container.querySelector<HTMLInputElement>('#inputNewEmail')!
    const btnAddEmail = this.container.querySelector<HTMLButtonElement>('#btnAddEmail')!
    const verifyRow = this.container.querySelector<HTMLElement>('#verifyNewEmailRow')!
    const devHelper = this.container.querySelector<HTMLElement>('#newEmailDevHelper')!
    const inputNewEmailCode = this.container.querySelector<HTMLInputElement>('#inputNewEmailCode')!
    const btnConfirmVerify = this.container.querySelector<HTMLButtonElement>('#btnConfirmVerifyEmail')!

    // Theme Radios
    const themeRadios = this.container.querySelectorAll<HTMLInputElement>('input[name="themeOption"]')
    themeRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          themeManager.setTheme(radio.value as ThemeMode)
        }
      })
    })

    // Language Radios
    const langRadios = this.container.querySelectorAll<HTMLInputElement>('input[name="langOption"]')
    langRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          i18n.setLocale(radio.value as SupportedLocale)
          this.render()
        }
      })
    })

    btnSaveProfile.addEventListener('click', async () => {
      const name = inputName.value.trim()
      const username = inputUsername.value.trim()
      try {
        await api.updateProfile({ name, username })
        this.showFlash('Profile updated successfully', 'success')
        await this.loadData()
      } catch (err: any) {
        this.showFlash(err.message || 'Error updating profile', 'error')
      }
    })

    let pendingAddEmail = ''

    btnAddEmail.addEventListener('click', async () => {
      const email = inputNewEmail.value.trim()
      if (!email) return
      try {
        const res = await api.requestAddEmail(email)
        pendingAddEmail = email
        verifyRow.style.display = 'block'
        if ((res as any).devCode) {
          devHelper.style.display = 'block'
          devHelper.textContent = `[Dev Mode] Verification code: ${(res as any).devCode}`
        }
        inputNewEmailCode.focus()
      } catch (err: any) {
        this.showFlash(err.message || 'Error requesting email verification', 'error')
      }
    })

    btnConfirmVerify.addEventListener('click', async () => {
      const code = inputNewEmailCode.value.trim()
      if (!code || !pendingAddEmail) return
      try {
        await api.verifyAddEmail(pendingAddEmail, code)
        verifyRow.style.display = 'none'
        inputNewEmail.value = ''
        inputNewEmailCode.value = ''
        this.showFlash('Email verified and added!', 'success')
        await this.loadData()
      } catch (err: any) {
        this.showFlash(err.message || 'Invalid verification code', 'error')
      }
    })
  }
}
