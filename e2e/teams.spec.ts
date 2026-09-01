import { test, expect } from '@playwright/test'
import { boot } from './helpers'

test('teams and invitations full lifecycle in browser (private teams, domain teams, invitations)', async ({ page, browser }) => {
  // 1. User Alice registers & logs in
  await boot(page)
  await page.locator('#btnOpenAuth').click()
  await page.locator('#authEmailInput').fill('alice@acme.corp')
  await page.locator('#btnSendCode').click()

  // New user registration step
  await expect(page.locator('#authStepRegister')).toBeVisible()
  await page.locator('#regUsernameInput').fill('alice_lead')
  await page.locator('#regNameInput').fill('Alice Lead')
  await page.locator('#btnRegisterSendCode').click()

  // Dev code autofill
  await expect(page.locator('#authStepCode')).toBeVisible()
  await page.locator('#btnVerifyCode').click()
  await expect(page.locator('#userBadgeName')).toContainText('Alice Lead')

  // 2. Alice opens Teams modal and creates Private Team "Core Architecture"
  await page.locator('#btnTeams').click()
  await expect(page.locator('#teamsModal')).toBeVisible()

  await page.locator('#newTeamNameInput').fill('Core Architecture')
  await page.locator('#btnCreateTeam').click()
  await expect(page.locator('#joinedTeamsList')).toContainText('Core Architecture')

  // 3. Alice opens Team details and invites Bob (@bob_dev)
  await page.locator('#joinedTeamsList').getByRole('button', { name: 'View / Manage' }).click()
  await expect(page.locator('#teamDetailsModal')).toBeVisible()
  await expect(page.locator('#teamDetailName')).toHaveText('Core Architecture')

  await page.locator('#teamInviteTargetInput').fill('bob_dev')
  await page.locator('#btnSendTeamInvite').click()
  await page.locator('#btnCloseTeamDetailsModal').click()
  await page.locator('#btnCloseTeamsModal').click()

  // 4. Bob registers in a second browser session
  const bobContext = await browser.newContext()
  const bobPage = await bobContext.newPage()
  await boot(bobPage)

  await bobPage.locator('#btnOpenAuth').click()
  await bobPage.locator('#authEmailInput').fill('bob@acme.corp')
  await bobPage.locator('#btnSendCode').click()

  await expect(bobPage.locator('#authStepRegister')).toBeVisible()
  await bobPage.locator('#regUsernameInput').fill('bob_dev')
  await bobPage.locator('#regNameInput').fill('Bob Developer')
  await bobPage.locator('#btnRegisterSendCode').click()
  await expect(bobPage.locator('#authStepCode')).toBeVisible()
  await bobPage.locator('#btnVerifyCode').click()
  await expect(bobPage.locator('#userBadgeName')).toContainText('Bob Developer')

  // 5. Bob opens Teams modal, sees pending invitation to "Core Architecture", and accepts it
  await bobPage.locator('#btnTeams').click()
  await expect(bobPage.locator('#pendingInvsSection')).toBeVisible()
  await expect(bobPage.locator('#pendingInvsList')).toContainText('Core Architecture')

  await bobPage.locator('#pendingInvsList').getByRole('button', { name: 'Accept' }).click()
  await expect(bobPage.locator('#joinedTeamsList')).toContainText('Core Architecture')

  // 6. Bob also sees available Domain Team for @acme.corp and joins it
  await expect(bobPage.locator('#availDomainTeamsSection')).toBeVisible()
  await expect(bobPage.locator('#availDomainTeamsList')).toContainText('acme.corp Team')

  await bobPage.locator('#availDomainTeamsList').getByRole('button', { name: 'Join Team' }).click()
  await expect(bobPage.locator('#joinedTeamsList')).toContainText('acme.corp Team')

  // Cleanup
  await bobContext.close()
})
