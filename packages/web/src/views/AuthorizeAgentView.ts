import { api } from '../services/api'
import { router } from '../router'

export class AuthorizeAgentView {
  private container: HTMLElement
  private query: URLSearchParams
  private flashTimer: any = null

  constructor(container: HTMLElement, query: URLSearchParams) {
    this.container = container
    this.query = query
  }

  async render(): Promise<void> {
    const clientName = this.query.get('client_name') || this.query.get('client') || 'AI Assistant CLI'
    const codeChallenge = this.query.get('code_challenge') || ''
    const redirectUri = this.query.get('redirect_uri') || 'http://127.0.0.1:8788/callback'

    this.container.innerHTML = `
      <div style="display: flex; min-height: 100vh; align-items: center; justify-content: center; background: var(--bg-app); padding: 20px;">
        <div style="width: 100%; max-width: 500px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 32px; box-shadow: var(--shadow-lg);">
          
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
            <div style="width: 44px; height: 44px; border-radius: var(--radius-md); background: #f3e8ff; color: #8b5cf6; display: flex; align-items: center; justify-content: center; font-size: 24px;">
              🤖
            </div>
            <div>
              <h2 style="font-size: 18px; font-weight: 700; margin: 0 0 2px; color: var(--text-primary);">Authorize AI Agent</h2>
              <p style="font-size: 12px; color: var(--text-secondary); margin: 0;">An application is requesting programmatic access to md4lp</p>
            </div>
          </div>

          <div style="background: var(--bg-sidebar); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 12px; margin-bottom: 20px;">
            <div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">${clientName}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Loopback RFC 7636 Authorization (${redirectUri})</div>
          </div>

          <h4 style="font-size: 13px; font-weight: 600; margin: 0 0 8px;">Select Project Access & Permissions</h4>
          <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 12px;">Choose which repositories this agent can access and its maximum role:</p>

          <div id="agentProjectScopesList" style="max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 8px;">
            <div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 12px;">Loading your projects...</div>
          </div>

          <!-- Flash Banner -->
          <div id="authAgentFlash" style="display: none; align-items: center; justify-content: center; gap: 8px; font-size: 12px; font-weight: 500; padding: 8px 16px; border-radius: var(--radius-md); margin-bottom: 16px; transition: all 0.2s ease;"></div>

          <div id="authAgentResultSuccess" style="display: none; padding: 16px; background: var(--success-bg); border: 1px solid var(--success-border); border-radius: var(--radius-md); text-align: center; margin-bottom: 16px;">
            <b style="color: var(--success-text); font-size: 14px;">✅ Agent Authorized Successfully!</b>
            <p style="font-size: 12px; color: var(--success-text); margin: 4px 0 12px;">The credentials have been sent to your local terminal session.</p>
            <button id="btnCloseAgentSuccess" class="btn btn-primary" style="font-size: 12px;">Done / Close</button>
          </div>

          <div id="authAgentButtonsRow" style="display: flex; justify-content: flex-end; gap: 8px;">
            <button id="btnCancelAuthAgent" class="btn btn-ghost">Cancel</button>
            <button id="btnGrantAgentAccess" class="btn btn-primary">Authorize Agent</button>
          </div>

        </div>
      </div>
    `

    await this.loadProjects(clientName, codeChallenge, redirectUri)
  }

  private showFlash(message: string, type: 'success' | 'error' = 'success'): void {
    const flash = this.container.querySelector<HTMLElement>('#authAgentFlash')
    if (!flash) return
    if (this.flashTimer) clearTimeout(this.flashTimer)

    flash.textContent = message
    flash.style.display = 'flex'
    flash.style.background = type === 'success' ? 'var(--primary-subtle, #ecfdf5)' : 'var(--danger-bg, #fef2f2)'
    flash.style.color = type === 'success' ? 'var(--accent-primary, #059669)' : 'var(--danger-text, #dc2626)'
    flash.style.border = `1px solid ${type === 'success' ? 'var(--accent-primary, #10b981)' : 'var(--danger-border, #fca5a5)'}`

    this.flashTimer = setTimeout(() => {
      flash.style.display = 'none'
    }, 3500)
  }

  private async loadProjects(clientName: string, codeChallenge: string, redirectUri: string): Promise<void> {
    try {
      await api.getMe()
      const projsRes = await api.listProjects()
      const projects = projsRes.projects || []

      const list = this.container.querySelector<HTMLElement>('#agentProjectScopesList')!
      const btnGrant = this.container.querySelector<HTMLButtonElement>('#btnGrantAgentAccess')!
      const btnCancel = this.container.querySelector<HTMLButtonElement>('#btnCancelAuthAgent')!
      const resultSuccess = this.container.querySelector<HTMLElement>('#authAgentResultSuccess')!
      const buttonsRow = this.container.querySelector<HTMLElement>('#authAgentButtonsRow')!
      const btnCloseSuccess = this.container.querySelector<HTMLButtonElement>('#btnCloseAgentSuccess')!

      if (projects.length === 0) {
        list.innerHTML = `<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 12px;">You don't have any projects yet.</div>`
      } else {
        list.innerHTML = projects.map((p) => {
          return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: var(--bg-app); border-radius: var(--radius-sm); font-size: 12px;">
              <div>
                <b>${p.name}</b>
                <span style="font-size: 10px; color: var(--text-muted); margin-left: 4px;">(${p.slug})</span>
              </div>
              <select class="input agent-role-select" data-project-id="${p.id}" style="width: 100px; font-size: 11px; padding: 2px 4px;">
                <option value="editor" selected>Editor</option>
                <option value="commenter">Commenter</option>
                <option value="viewer">Viewer</option>
                <option value="none">No Access</option>
              </select>
            </div>
          `
        }).join('')
      }

      btnCancel.addEventListener('click', () => {
        router.navigate('/projects')
      })

      btnCloseSuccess.addEventListener('click', () => {
        router.navigate('/projects')
      })

      btnGrant.addEventListener('click', async () => {
        const scopes: Array<{ projectId: string; maxRole: string }> = []
        list.querySelectorAll<HTMLSelectElement>('.agent-role-select').forEach((sel) => {
          const role = sel.value
          const projectId = sel.getAttribute('data-project-id')!
          if (role !== 'none') {
            scopes.push({ projectId, maxRole: role })
          }
        })

        if (!codeChallenge) {
          this.showFlash('Missing PKCE code challenge', 'error')
          return
        }

        btnGrant.disabled = true
        try {
          const grantRes = await api.createAgentGrant({
            agentName: clientName,
            codeChallenge,
            projectScopes: scopes,
          })

          // Send auth code back to loopback local server if redirectUri is standard
          try {
            const callbackUrl = new URL(redirectUri)
            callbackUrl.searchParams.set('code', grantRes.code)
            await fetch(callbackUrl.toString(), { mode: 'no-cors' }).catch(() => {})
          } catch {}

          buttonsRow.style.display = 'none'
          resultSuccess.style.display = 'block'
        } catch (err: any) {
          this.showFlash(err.message || 'Error granting agent access', 'error')
          btnGrant.disabled = false
        }
      })
    } catch {
      router.navigate('/login')
    }
  }
}
