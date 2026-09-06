// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HeaderNav } from '../src/services/headerNav'
import { router } from '../src/router'
import { api } from '../src/services/api'
import { i18n } from '../src/services/i18n'

describe('HeaderNav Component Regression Suite', () => {
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
    vi.restoreAllMocks()
  })

  it('renders brand, custom label, back button, and navigates properly', () => {
    const onBackMock = vi.fn()
    const nav = new HeaderNav(container, {
      viewLabel: 'Custom Section',
      showBack: true,
      onBack: onBackMock,
      showProjectsLink: true,
      showTeamsLink: true,
      rightCustomSlot: '<button id="btnCustomTest">Custom Action</button>',
    })

    container.innerHTML = nav.render()
    nav.bindEvents()

    expect(container.textContent).toContain('md4lp')
    expect(container.textContent).toContain('Custom Section')
    expect(container.querySelector('#btnCustomTest')).not.toBeNull()

    const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => {})

    // Click Brand
    container.querySelector<HTMLElement>('#btnBrandHome')!.click()
    expect(navSpy).toHaveBeenCalledWith('/projects')

    // Click Back
    container.querySelector<HTMLButtonElement>('#btnHeaderBack')!.click()
    expect(onBackMock).toHaveBeenCalled()

    // Click Go Projects
    container.querySelector<HTMLButtonElement>('#btnGoProjects')!.click()
    expect(navSpy).toHaveBeenCalledWith('/projects')

    // Click Go Teams
    container.querySelector<HTMLButtonElement>('#btnGoTeams')!.click()
    expect(navSpy).toHaveBeenCalledWith('/teams')
  })

  it('updates user profile information and pending notification count dynamically', () => {
    const nav = new HeaderNav(container, { viewLabel: 'Test' })
    container.innerHTML = nav.render()
    nav.bindEvents()

    const badge = container.querySelector<HTMLElement>('#notifBadgeCount')!
    expect(badge.style.display).toBe('none')

    // Set user with 3 notifications
    nav.setUser({ id: 'u1', name: 'Alice Smith', username: 'alice', defaultEmail: 'alice@corp.com', emails: [{ email: 'alice@corp.com', verified: true, primary: true }] }, 3)
    expect(container.querySelector('#navUserName')?.textContent).toBe('Alice Smith')
    expect(container.querySelector('#navUserHandle')?.textContent).toBe('@alice')
    expect(badge.style.display).toBe('inline-block')
    expect(badge.textContent).toBe('3')

    // Set user with 0 notifications -> badge hidden
    nav.setUser({ id: 'u1', name: 'Alice', username: 'alice', defaultEmail: 'alice@corp.com', emails: [{ email: 'alice@corp.com', verified: true, primary: true }] }, 0)
    expect(badge.style.display).toBe('none')

    // Clicking profile navigates to settings
    const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => {})
    container.querySelector<HTMLButtonElement>('#btnUserProfileSettings')!.click()
    expect(navSpy).toHaveBeenCalledWith('/settings')
  })

  it('handles language switching via selectHeaderLocale and fires callback', () => {
    const onLocaleChange = vi.fn()
    const nav = new HeaderNav(container)
    container.innerHTML = nav.render()
    nav.bindEvents(onLocaleChange)

    const select = container.querySelector<HTMLSelectElement>('#selectHeaderLocale')!
    expect(select).not.toBeNull()

    select.value = 'es'
    select.dispatchEvent(new Event('change'))

    expect(i18n.getLocale()).toBe('es')
    expect(onLocaleChange).toHaveBeenCalledWith('es')
  })

  it('manages sign-out confirmation modal workflow without native alert/confirm', async () => {
    const nav = new HeaderNav(container)
    container.innerHTML = nav.render()
    nav.bindEvents()

    const btnLogout = container.querySelector<HTMLButtonElement>('#btnLogoutNav')!
    const modalSignOut = container.querySelector<HTMLDialogElement>('#signOutModal')!
    const btnCancel = container.querySelector<HTMLButtonElement>('#btnCancelSignOut')!
    const btnConfirm = container.querySelector<HTMLButtonElement>('#btnConfirmSignOut')!

    expect(modalSignOut).not.toBeNull()
    expect(modalSignOut.open).toBeFalsy()

    // 1. Click logout opens dialog
    btnLogout.click()
    expect(modalSignOut.open).toBe(true)

    // 2. Click cancel closes dialog without logging out
    const logoutSpy = vi.spyOn(api, 'logout').mockResolvedValueOnce({ ok: true } as any)
    const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => {})

    btnCancel.click()
    expect(modalSignOut.open).toBe(false)
    expect(logoutSpy).not.toHaveBeenCalled()

    // 3. Click confirm calls api.logout() and navigates to /login
    btnLogout.click()
    expect(modalSignOut.open).toBe(true)

    btnConfirm.click()
    expect(modalSignOut.open).toBe(false)
    await new Promise((r) => setTimeout(r, 10))

    expect(logoutSpy).toHaveBeenCalled()
    expect(navSpy).toHaveBeenCalledWith('/login')
  })
})
