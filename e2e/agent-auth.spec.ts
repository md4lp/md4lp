import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'

test('agent authorization PKCE loopback flow and management in browser', async ({ page }) => {
  // 1. Register & authenticate user
  await page.goto('/')
  await page.click('#btnOpenAuth')
  await expect(page.locator('#authModal')).toBeVisible()

  await page.fill('#authEmailInput', 'alex@agent-tester.org')
  await page.click('#btnSendCode')

  await expect(page.locator('#authStepRegister')).toBeVisible()
  await page.fill('#regUsernameInput', 'alex')
  await page.fill('#regNameInput', 'Alex Engineer')
  await page.click('#btnRegisterSendCode')

  await expect(page.locator('#authStepCode')).toBeVisible()
  const devCodeEl = page.locator('#authDevHelper')
  await expect(devCodeEl).toBeVisible()
  const codeText = await devCodeEl.textContent()
  const code = codeText?.match(/\d{6}/)?.[0] || ''
  expect(code).toHaveLength(6)

  await page.fill('#authCodeInput', code)
  await page.click('#btnVerifyCode')
  await expect(page.locator('#authModal')).toBeHidden()
  await expect(page.locator('#userBadgeName')).toContainText('Alex Engineer')

  // 2. Create a project
  await page.click('#btnProjects')
  await expect(page.locator('#projectsModal')).toBeVisible()
  await page.fill('#newProjectNameInput', 'AI Agent Sandbox')
  await page.click('#btnCreateProject')
  await expect(page.locator('#joinedProjectsList')).toContainText('AI Agent Sandbox')
  await page.click('#btnCloseProjectsModal')

  // 3. Start a mock agent loopback receiver on 127.0.0.1
  const codeVerifier = 'e2e_test_code_verifier_entropy_string_123456789'
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  const state = 'e2e_state_token_123'

  let receivedCode = ''
  let receivedState = ''

  const loopbackServer = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/callback') {
      receivedCode = url.searchParams.get('code') || ''
      receivedState = url.searchParams.get('state') || ''
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('OK')
    } else {
      res.writeHead(404)
      res.end()
    }
  })

  const loopbackPort = await new Promise<number>((resolve) => {
    loopbackServer.listen(0, '127.0.0.1', () => {
      const addr = loopbackServer.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })

  // 4. Trigger loopback flow via hash
  await page.goto(`/#authorize-agent?port=${loopbackPort}&name=Antigravity%20Bot&challenge=${codeChallenge}&state=${state}`)
  await expect(page.locator('#authorizeAgentModal')).toBeVisible()
  await expect(page.locator('#authAgentClientName')).toHaveText('Antigravity Bot')
  await expect(page.locator('#authAgentProjectMatrix')).toContainText('AI Agent Sandbox')

  // 5. Authorize agent
  await page.click('#btnSubmitAuthorizeAgent')
  await expect(page.locator('#authAgentSuccessBox')).toBeVisible()

  // 6. Verify loopback server received the authorization code
  await expect.poll(() => receivedCode).not.toBe('')
  expect(receivedState).toBe(state)

  // 7. Exchange code for token via API as the agent runtime
  const tokenRes = await page.request.post('/api/auth/agent-token', {
    data: {
      code: receivedCode,
      codeVerifier,
    },
  })
  expect(tokenRes.status()).toBe(200)
  const tokenData = await tokenRes.json()
  expect(tokenData.ok).toBe(true)
  expect(tokenData.token).toMatch(/^md4lp_agt_/)
  expect(tokenData.agentName).toBe('Antigravity Bot')

  // 8. Close loopback server
  loopbackServer.close()

  // 9. Check Account Settings -> Connected AI Agents section
  await page.click('#btnCloseAuthorizeAgentSuccess')
  await page.click('#btnManageAccount')
  await expect(page.locator('#accountModal')).toBeVisible()
  await expect(page.locator('#connectedAgentsList')).toContainText('Antigravity Bot')
  await expect(page.locator('#connectedAgentsList')).toContainText('AI Agent Sandbox')

  // 10. Revoke agent session from UI
  page.once('dialog', async (dialog) => {
    await dialog.accept()
  })
  await page.click('.btn-revoke-agent')
  await expect(page.locator('#connectedAgentsList')).toContainText('Revoked / Expired')

  // 11. Test that the revoked token can no longer access the API
  const apiAfterRevoke = await page.request.get('/api/projects', {
    headers: {
      authorization: `Bearer ${tokenData.token}`,
    },
  })
  expect(apiAfterRevoke.status()).toBe(401)
})
