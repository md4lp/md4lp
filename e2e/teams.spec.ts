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

  // 3. Alice opens Team details, invites Bob (@bob_dev) and external partner (partner@other.org)
  await page.locator('#joinedTeamsList').getByRole('button', { name: 'View / Manage' }).click()
  await expect(page.locator('#teamDetailsModal')).toBeVisible()
  await expect(page.locator('#teamDetailName')).toHaveText('Core Architecture')

  await page.locator('#teamInviteTargetInput').fill('bob_dev')
  await page.locator('#btnSendTeamInvite').click()
  await expect(page.locator('#status')).toContainText('Invitation sent to bob_dev')

  // Invite external email
  await page.locator('#teamInviteTargetInput').fill('partner@other.org')
  await page.locator('#btnSendTeamInvite').click()
  await expect(page.locator('#status')).toContainText('Invitation sent to partner@other.org')

  // Alice sees partner@other.org in pending invitations and revokes it
  await expect(page.locator('#teamDetailPendingInvsSection')).toBeVisible()
  await expect(page.locator('#teamDetailPendingInvsList')).toContainText('partner@other.org')
  page.once('dialog', (d) => d.accept())
  await page.locator('#teamDetailPendingInvsList div:has-text("partner@other.org") button:has-text("Revoke")').click()
  await expect(page.locator('#status')).toContainText('Team invitation revoked')
  await expect(page.locator('#teamDetailPendingInvsList')).not.toContainText('partner@other.org')

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

  // 5. Bob sees notification bell badge count "1" -> clicks it -> opens Notifications Modal
  await expect(bobPage.locator('#notifBadge')).toBeVisible()
  await expect(bobPage.locator('#notifBadge')).toHaveText('1')

  await bobPage.locator('#btnNotifications').click()
  await expect(bobPage.locator('#notificationsModal')).toBeVisible()
  await expect(bobPage.locator('#notifTeamInvsSection')).toBeVisible()
  await expect(bobPage.locator('#notifTeamInvsList')).toContainText('Core Architecture')

  // Bob clicks "Review / Go to Teams" -> opens Teams modal -> accepts invitation
  await bobPage.locator('#notifTeamInvsList button:has-text("Review / Go to Teams")').click()
  await expect(bobPage.locator('#teamsModal')).toBeVisible()
  await expect(bobPage.locator('#pendingInvsSection')).toBeVisible()
  await expect(bobPage.locator('#pendingInvsList')).toContainText('Core Architecture')

  await bobPage.locator('#pendingInvsList').getByRole('button', { name: 'Accept' }).click()
  await expect(bobPage.locator('#joinedTeamsList')).toContainText('Core Architecture')

  // 6. Bob also sees available Domain Team for @acme.corp and joins it
  await expect(bobPage.locator('#availDomainTeamsSection')).toBeVisible()
  await expect(bobPage.locator('#availDomainTeamsList')).toContainText('acme.corp Team')

  await bobPage.locator('#availDomainTeamsList').getByRole('button', { name: 'Join' }).click()
  await expect(bobPage.locator('#joinedTeamsList')).toContainText('acme.corp Team')

  // Notification badge is now hidden (0 pending)
  await expect(bobPage.locator('#notifBadge')).toBeHidden()

  // Cleanup
  await bobContext.close()
})
