import { api } from '../services/api'
import { router } from '../router'

export class LoginView {
  private container: HTMLElement

  constructor(container: HTMLElement) {
    this.container = container
  }

  render(): void {
    this.container.innerHTML = `
      <div style="display: flex; min-height: 100vh; align-items: center; justify-content: center; background: var(--bg-app); padding: 20px;">
        <div style="width: 100%; max-width: 400px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 32px; box-shadow: var(--shadow-lg);">
          
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: var(--radius-md); background: var(--accent-subtle); color: var(--accent-primary); font-size: 24px; margin-bottom: 12px;">
              📝
            </div>
            <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 6px; color: var(--text-primary);">md4lp</h1>
            <p style="font-size: 13px; color: var(--text-secondary); margin: 0;">Markdown for legacy people. Backed by Git.</p>
          </div>

          <div id="loginAlert" style="display: none; padding: 10px 14px; border-radius: var(--radius-md); font-size: 12px; margin-bottom: 16px;"></div>

          <!-- Step 1: Identifier Entry -->
          <div id="stepIdentifier">
            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">Email or Username</label>
            <input id="inputIdentifier" class="input" type="text" placeholder="name@company.com or username" autofocus />
            <button id="btnContinue" class="btn btn-primary" style="width: 100%; margin-top: 16px; padding: 10px;">
              Continue with OTP
            </button>
          </div>

          <!-- Step 1.5: New User Registration Profile -->
          <div id="stepRegister" style="display: none;">
            <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 12px;">Let's create your md4lp account.</p>
            
            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">Email</label>
            <input id="inputRegEmail" class="input" type="email" placeholder="name@company.com" style="margin-bottom: 12px;" />

            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">Username (@handle)</label>
            <input id="inputRegUsername" class="input" type="text" placeholder="alice" style="margin-bottom: 12px;" />

            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">Display Name</label>
            <input id="inputRegName" class="input" type="text" placeholder="Alice Smith" style="margin-bottom: 16px;" />

            <div style="display: flex; gap: 8px;">
              <button id="btnBackToIdentifier" class="btn btn-ghost" style="flex: 1;">Back</button>
              <button id="btnRegisterSubmit" class="btn btn-primary" style="flex: 2;">Send Code</button>
            </div>
          </div>

          <!-- Step 2: Verification Code Entry -->
          <div id="stepCode" style="display: none;">
            <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 12px;">
              We sent a 6-digit code to <b id="codeTargetEmail" style="color: var(--text-primary);"></b>
            </p>

            <div id="devOutboxHelper" style="display: none; background: var(--warning-bg); border: 1px solid var(--warning-border); color: var(--warning-text); padding: 8px 12px; border-radius: var(--radius-md); font-size: 12px; margin-bottom: 12px;"></div>

            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">Verification Code</label>
            <input id="inputCode" class="input" type="text" maxlength="6" placeholder="123456" style="text-align: center; letter-spacing: 4px; font-size: 16px; font-weight: 700; margin-bottom: 16px;" autofocus />

            <div style="display: flex; gap: 8px;">
              <button id="btnBackToStart" class="btn btn-ghost" style="flex: 1;">Back</button>
              <button id="btnVerify" class="btn btn-primary" style="flex: 2;">Verify & Sign In</button>
            </div>
          </div>

        </div>
      </div>
    `

    this.bindEvents()
  }

  private bindEvents(): void {
    const stepIdentifier = this.container.querySelector<HTMLElement>('#stepIdentifier')!
    const stepRegister = this.container.querySelector<HTMLElement>('#stepRegister')!
    const stepCode = this.container.querySelector<HTMLElement>('#stepCode')!

    const inputIdentifier = this.container.querySelector<HTMLInputElement>('#inputIdentifier')!
    const inputRegEmail = this.container.querySelector<HTMLInputElement>('#inputRegEmail')!
    const inputRegUsername = this.container.querySelector<HTMLInputElement>('#inputRegUsername')!
    const inputRegName = this.container.querySelector<HTMLInputElement>('#inputRegName')!
    const inputCode = this.container.querySelector<HTMLInputElement>('#inputCode')!

    const btnContinue = this.container.querySelector<HTMLButtonElement>('#btnContinue')!
    const btnRegisterSubmit = this.container.querySelector<HTMLButtonElement>('#btnRegisterSubmit')!
    const btnVerify = this.container.querySelector<HTMLButtonElement>('#btnVerify')!
    const btnBackToIdentifier = this.container.querySelector<HTMLButtonElement>('#btnBackToIdentifier')!
    const btnBackToStart = this.container.querySelector<HTMLButtonElement>('#btnBackToStart')!

    const loginAlert = this.container.querySelector<HTMLElement>('#loginAlert')!
    const codeTargetEmail = this.container.querySelector<HTMLElement>('#codeTargetEmail')!
    const devOutboxHelper = this.container.querySelector<HTMLElement>('#devOutboxHelper')!

    const showAlert = (msg: string, type: 'error' | 'success' = 'error') => {
      loginAlert.style.display = 'block'
      loginAlert.style.background = type === 'error' ? 'var(--danger-bg)' : 'var(--success-bg)'
      loginAlert.style.color = type === 'error' ? 'var(--danger-text)' : 'var(--success-text)'
      loginAlert.style.border = `1px solid ${type === 'error' ? 'var(--danger-border)' : 'var(--success-border)'}`
      loginAlert.textContent = msg
    }

    const clearAlert = () => {
      loginAlert.style.display = 'none'
    }

    let currentIdentifier = ''
    let currentRegDetails: { email?: string; username?: string; name?: string } = {}

    // Step 1: Identifier
    btnContinue.addEventListener('click', async () => {
      clearAlert()
      const val = inputIdentifier.value.trim()
      if (!val) {
        showAlert('Please enter an email or username')
        return
      }

      btnContinue.disabled = true
      try {
        const lookup = await api.lookupIdentifier(val)
        currentIdentifier = val

        if (!lookup.exists) {
          // New user -> show registration
          stepIdentifier.style.display = 'none'
          stepRegister.style.display = 'block'
          if (val.includes('@')) {
            inputRegEmail.value = val
            inputRegUsername.value = val.split('@')[0] || ''
          } else {
            inputRegUsername.value = val
          }
        } else {
          // Existing user -> send code
          await api.requestCode({ identifier: val, purpose: 'login' })
          const target = lookup.email || val
          codeTargetEmail.textContent = target
          stepIdentifier.style.display = 'none'
          stepCode.style.display = 'block'

          // Dev helper
          api.getDevOutbox(target).then((res) => {
            if (res.emails?.length) {
              const latest = res.emails[res.emails.length - 1]
              devOutboxHelper.style.display = 'block'
              devOutboxHelper.innerHTML = `Dev helper: Verification code is <b>${latest.code}</b>`
            }
          }).catch(() => {})
        }
      } catch (err: any) {
        showAlert(err.message || 'Error looking up identifier')
      } finally {
        btnContinue.disabled = false
      }
    })

    // Step 1.5: Register Submit
    btnRegisterSubmit.addEventListener('click', async () => {
      clearAlert()
      const email = inputRegEmail.value.trim()
      const username = inputRegUsername.value.trim()
      const name = inputRegName.value.trim()

      if (!email || !username) {
        showAlert('Email and username are required')
        return
      }

      btnRegisterSubmit.disabled = true
      try {
        currentRegDetails = { email, username, name }
        currentIdentifier = email
        await api.requestCode({ identifier: email, username, name, purpose: 'login' })
        codeTargetEmail.textContent = email
        stepRegister.style.display = 'none'
        stepCode.style.display = 'block'

        api.getDevOutbox(email).then((res) => {
          if (res.emails?.length) {
            const latest = res.emails[res.emails.length - 1]
            devOutboxHelper.style.display = 'block'
            devOutboxHelper.innerHTML = `Dev helper: Verification code is <b>${latest.code}</b>`
          }
        }).catch(() => {})
      } catch (err: any) {
        showAlert(err.message || 'Error requesting registration code')
      } finally {
        btnRegisterSubmit.disabled = false
      }
    })

    // Step 2: Verify Code
    btnVerify.addEventListener('click', async () => {
      clearAlert()
      const code = inputCode.value.trim()
      if (!code || code.length !== 6) {
        showAlert('Please enter the 6-digit code')
        return
      }

      btnVerify.disabled = true
      try {
        await api.verifyCode({
          identifier: currentIdentifier,
          code,
          purpose: 'login',
          username: currentRegDetails.username,
          name: currentRegDetails.name,
        })
        router.navigate('/projects')
      } catch (err: any) {
        showAlert(err.message || 'Invalid or expired verification code')
      } finally {
        btnVerify.disabled = false
      }
    })

    btnBackToIdentifier.addEventListener('click', () => {
      clearAlert()
      stepRegister.style.display = 'none'
      stepIdentifier.style.display = 'block'
    })

    btnBackToStart.addEventListener('click', () => {
      clearAlert()
      stepCode.style.display = 'none'
      stepIdentifier.style.display = 'block'
    })
  }
}
