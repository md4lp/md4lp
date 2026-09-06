import { i18n, type SupportedLocale } from './i18n'
import { router } from '../router'
import { api, type UserProfile } from './api'

export interface HeaderNavOptions {
  showProjectsLink?: boolean
  showTeamsLink?: boolean
  showBack?: boolean
  backTitle?: string
  onBack?: () => void
  viewLabel?: string
  rightCustomSlot?: string
  flashId?: string
}

export class HeaderNav {
  private container: HTMLElement
  private options: HeaderNavOptions
  private user: UserProfile | null = null
  private pendingCount: number = 0

  constructor(container: HTMLElement, options: HeaderNavOptions = {}) {
    this.container = container
    this.options = options
  }

  setUser(user: UserProfile | null, pendingCount: number = 0): void {
    this.user = user
    this.pendingCount = pendingCount
    this.updateUserAndNotifs()
  }

  render(): string {
    const t = i18n.t
    const currentLocale = i18n.getLocale()

    const backButtonHtml = this.options.showBack
      ? `<button id="btnHeaderBack" class="btn btn-ghost" title="${this.options.backTitle || t.common.back}" style="font-size: 14px; padding: 4px 8px;">←</button>`
      : ''

    const viewLabel = this.options.viewLabel || t.dashboard.title
    const leftSlotHtml = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 20px;">📝</span>
        <span style="font-weight: 700; font-size: 16px; color: var(--text-primary); cursor: pointer;" id="btnBrandHome">md4lp</span>
        <span style="color: var(--border-medium); margin: 0 2px;">/</span>
        <span style="font-size: 13px; font-weight: 600; color: var(--text-primary);">${viewLabel}</span>
      </div>
    `

    const flashId = this.options.flashId || 'headerFlash'

    // Projects link (for subviews like Teams, Settings)
    const projectsLinkHtml = this.options.showProjectsLink
      ? `<button id="btnGoProjects" class="btn btn-ghost" title="${t.dashboard.projectsSubtitle}" style="font-size: 13px; padding: 4px 10px; display: flex; align-items: center; gap: 6px;">
          📚 <span>${t.dashboard.projectsTitle}</span>
         </button>`
      : ''

    // Teams button (Dashboard only)
    const teamsButtonHtml = this.options.showTeamsLink
      ? `<button id="btnGoTeams" class="btn btn-ghost" title="${t.dashboard.teamsTooltip}" style="font-size: 13px; padding: 4px 10px; display: flex; align-items: center; gap: 6px;">
          👥 <span>${t.dashboard.teamsButton}</span>
         </button>`
      : ''

    const rightSlotHtml = this.options.rightCustomSlot || ''

    const userName = this.user ? (this.user.name || this.user.username) : ''
    const userHandle = this.user ? `@${this.user.username}` : ''
    const notifDisplay = this.pendingCount > 0 ? 'inline-block' : 'none'

    return `
      <header style="position: relative; height: var(--header-height); background: var(--bg-surface); border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between; padding: 0 20px; z-index: 10;">
        <div style="display: flex; align-items: center; gap: 12px;">
          ${backButtonHtml}
          ${leftSlotHtml}
        </div>

        <!-- Flash Banner Centered -->
        <div id="${flashId}" style="display: none; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); align-items: center; gap: 8px; font-size: 12px; font-weight: 500; padding: 6px 16px; border-radius: var(--radius-full); box-shadow: var(--shadow-sm); z-index: 20; pointer-events: none; transition: all 0.2s ease;"></div>

        <!-- Navigation Right Actions in Strict Order -->
        <div id="userBadgeNav" style="display: flex; align-items: center; gap: 10px;">
          
          <!-- Custom View Actions (e.g. Share & Comments button in Workspace) -->
          ${rightSlotHtml}

          <!-- Optional navigation links -->
          ${projectsLinkHtml}
          ${teamsButtonHtml}

          <!-- 1. Notifications Bell (Right beside user profile) -->
          <button id="btnOpenNotifications" class="btn btn-ghost" title="${t.dashboard.notificationsTitle}" style="position: relative; font-size: 14px; padding: 4px 8px;">
            🔔<span id="notifBadgeCount" style="display: ${notifDisplay}; position: absolute; top: -2px; right: -2px; background: var(--danger-text); color: #fff; font-size: 9px; font-weight: 700; border-radius: 10px; padding: 1px 4px;">${this.pendingCount}</span>
          </button>

          <!-- 2. User Profile Button -> navigates to Settings -->
          <button id="btnUserProfileSettings" class="btn btn-ghost" title="${t.dashboard.profileTooltip}" style="display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-radius: var(--radius-md); text-align: left;">
            <span style="font-size: 16px;">👤</span>
            <div style="line-height: 1.2;">
              <div id="navUserName" style="font-size: 12px; font-weight: 600; color: var(--text-primary);">${userName}</div>
              <div id="navUserHandle" style="font-size: 10px; color: var(--text-muted);">${userHandle}</div>
            </div>
          </button>

          <!-- 3. Language Selector Dropdown -->
          <div style="position: relative; display: inline-flex; align-items: center;">
            <select id="selectHeaderLocale" class="input" style="font-size: 12px; padding: 3px 6px; height: 28px; cursor: pointer; border-radius: var(--radius-sm); background: var(--bg-app);">
              <option value="en" ${currentLocale === 'en' ? 'selected' : ''}>🇬🇧 EN</option>
              <option value="es" ${currentLocale === 'es' ? 'selected' : ''}>🇪🇸 ES</option>
            </select>
          </div>

          <!-- 4. Sign Out Icon Button with Tooltip -->
          <button id="btnLogoutNav" class="btn btn-ghost" title="${t.common.signOut}" style="font-size: 14px; padding: 4px 8px; display: inline-flex; align-items: center; justify-content: center; color: var(--text-secondary);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        </div>
      </header>

      <!-- Sign Out Confirmation Modal Dialog -->
      <dialog id="signOutModal" style="max-width: 420px; width: 90%; border: 1px solid var(--border-default); border-radius: var(--radius-lg); background: var(--bg-surface); color: var(--text-primary); padding: 24px; box-shadow: var(--shadow-lg);">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: var(--radius-full); background: var(--bg-app); border: 1px solid var(--border-subtle); color: var(--text-secondary);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </div>
          <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-primary);">${t.common.signOut}</h3>
        </div>
        
        <p style="font-size: 13px; color: var(--text-secondary); margin: 0 0 20px; line-height: 1.5;">
          ${t.common.signOutDescription}
        </p>

        <div style="display: flex; justify-content: flex-end; gap: 10px;">
          <button id="btnCancelSignOut" class="btn btn-ghost" style="font-size: 13px; padding: 6px 14px;">${t.common.cancel}</button>
          <button id="btnConfirmSignOut" class="btn btn-danger" style="font-size: 13px; padding: 6px 14px;">${t.common.signOut}</button>
        </div>
      </dialog>
    `
  }

  bindEvents(onLocaleChange?: (locale: SupportedLocale) => void): void {
    const btnBrand = this.container.querySelector<HTMLElement>('#btnBrandHome')
    if (btnBrand) {
      btnBrand.addEventListener('click', () => router.navigate('/projects'))
    }

    const btnBack = this.container.querySelector<HTMLButtonElement>('#btnHeaderBack')
    if (btnBack) {
      btnBack.addEventListener('click', () => {
        if (this.options.onBack) {
          this.options.onBack()
        } else {
          router.navigate('/projects')
        }
      })
    }

    const btnProjects = this.container.querySelector<HTMLButtonElement>('#btnGoProjects')
    if (btnProjects) {
      btnProjects.addEventListener('click', () => router.navigate('/projects'))
    }

    const btnTeams = this.container.querySelector<HTMLButtonElement>('#btnGoTeams')
    if (btnTeams) {
      btnTeams.addEventListener('click', () => router.navigate('/teams'))
    }

    const btnProfile = this.container.querySelector<HTMLButtonElement>('#btnUserProfileSettings')
    if (btnProfile) {
      btnProfile.addEventListener('click', () => router.navigate('/settings'))
    }

    const selectLocale = this.container.querySelector<HTMLSelectElement>('#selectHeaderLocale')
    if (selectLocale) {
      selectLocale.addEventListener('change', () => {
        const next = selectLocale.value as SupportedLocale
        i18n.setLocale(next)
        if (onLocaleChange) {
          onLocaleChange(next)
        }
      })
    }

    const btnLogout = this.container.querySelector<HTMLButtonElement>('#btnLogoutNav')
    const modalSignOut = this.container.querySelector<HTMLDialogElement>('#signOutModal')
    const btnCancelSignOut = this.container.querySelector<HTMLButtonElement>('#btnCancelSignOut')
    const btnConfirmSignOut = this.container.querySelector<HTMLButtonElement>('#btnConfirmSignOut')

    if (btnLogout && modalSignOut) {
      btnLogout.addEventListener('click', () => {
        modalSignOut.showModal()
      })
    }

    if (btnCancelSignOut && modalSignOut) {
      btnCancelSignOut.addEventListener('click', () => {
        modalSignOut.close()
      })
    }

    if (btnConfirmSignOut && modalSignOut) {
      btnConfirmSignOut.addEventListener('click', async () => {
        modalSignOut.close()
        await api.logout()
        router.navigate('/login')
      })
    }
  }

  private updateUserAndNotifs(): void {
    const nameEl = this.container.querySelector<HTMLElement>('#navUserName')
    const handleEl = this.container.querySelector<HTMLElement>('#navUserHandle')
    const badgeEl = this.container.querySelector<HTMLElement>('#notifBadgeCount')

    if (nameEl && this.user) {
      nameEl.textContent = this.user.name || this.user.username
    }
    if (handleEl && this.user) {
      handleEl.textContent = `@${this.user.username}`
    }
    if (badgeEl) {
      if (this.pendingCount > 0) {
        badgeEl.style.display = 'inline-block'
        badgeEl.textContent = String(this.pendingCount)
      } else {
        badgeEl.style.display = 'none'
      }
    }
  }
}
