import { test, expect } from '@playwright/test'

test('full end-to-end user lifecycle on new modular web SPA (auth, projects, teams, share, workspace editing)', async ({ page }) => {
  // 1. Visit SPA root -> redirects to #/login
  await page.goto('/')
  await expect(page).toHaveURL(/#\/login/)
  await expect(page.locator('h1')).toContainText('md4lp')

  // 2. Sign up as a new user with OTP
  await page.fill('#inputIdentifier', 'alice@acme.corp')
  await page.click('#btnContinue')

  // Registration step
  await expect(page.locator('#stepRegister')).toBeVisible()
  await page.fill('#inputRegUsername', 'alice')
  await page.fill('#inputRegName', 'Alice Engineer')
  await page.click('#btnRegisterSubmit')

  // Code verification step with Dev Helper code
  await expect(page.locator('#stepCode')).toBeVisible()
  const devHelper = page.locator('#devOutboxHelper')
  await expect(devHelper).toBeVisible()
  const devCodeMatch = (await devHelper.textContent())?.match(/\d{6}/)
  expect(devCodeMatch).not.toBeNull()
  const otpCode = devCodeMatch![0]

  await page.fill('#inputCode', otpCode)
  await page.click('#btnVerify')

  // 3. Lands on Dashboard #/projects
  await expect(page).toHaveURL(/#\/projects/)
  await expect(page.locator('#navUserName')).toContainText('Alice Engineer')
  await expect(page.locator('#navUserHandle')).toContainText('@alice')

  // 4. Create a new repository project
  await page.click('#btnNewProject')
  await expect(page.locator('#createProjectCard')).toBeVisible()
  await page.fill('#inputProjName', 'Engineering Docs')
  await page.fill('#inputProjDesc', 'Knowledge base for engineering team')
  await page.click('#btnSubmitCreateProj')

  // Project appears in grid
  await expect(page.locator('.project-card')).toContainText('Engineering Docs')
  await expect(page.locator('.project-card')).toContainText('owner')

  // 5. Navigate to Teams (#/teams)
  await page.click('#btnGoTeams')
  await expect(page).toHaveURL(/#\/teams/)
  await expect(page.locator('h2')).toContainText('Your Teams')

  // Create private team
  await page.click('#btnOpenCreateTeam')
  await page.fill('#inputNewTeamName', 'Frontend Core')
  await page.click('#btnSubmitCreateTeam')
  await expect(page.locator('#teamsGrid')).toContainText('Frontend Core')

  // Domain team auto-detected for @acme.corp
  await expect(page.locator('#domainTeamsSection')).toContainText('acme.corp')
  await page.click('.btn-join-domain')
  await expect(page.locator('#teamsGrid')).toContainText('acme.corp Team')

  // 6. Navigate to Settings (#/settings) and test Appearance theme switcher
  await page.goto('/#/settings')
  await expect(page.locator('h3:has-text("Appearance")')).toBeVisible()
  await page.click('input[value="dark"]')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.click('input[value="light"]')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  // 7. Open Project Workspace (#/p/engineering-docs)
  await page.goto('/#/p/engineering-docs')
  await expect(page.locator('#headerProjectName')).toContainText('Engineering Docs')
  await expect(page.locator('aside:has-text("Explorer")')).toBeVisible()

  // Create a new nested document
  await page.click('#btnNewDoc')
  await page.fill('#inputNewDocPath', 'guides/setup.md')
  await page.click('#btnSubmitNewDoc')
  await expect(page.locator('#treeContainer')).toContainText('setup.md')

  // 8. Open Share & Settings (#/p/engineering-docs/settings)
  await page.click('#btnProjectSettings')
  await expect(page).toHaveURL(/#\/p\/engineering-docs\/settings/)
  await expect(page.locator('#projSettingName')).toContainText('Share & Settings: Engineering Docs')
  await expect(page.locator('#projectMembersList')).toContainText('@alice')

  // Assign Team to Project
  await page.selectOption('#selectAssignTeam', { label: 'Frontend Core (private)' })
  await page.click('#btnAssignTeam')
  await expect(page.locator('#projectAssignedTeamsList')).toContainText('Frontend Core')
})
