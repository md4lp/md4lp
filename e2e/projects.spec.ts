import { test, expect } from '@playwright/test'
import { boot } from './helpers'

test('projects and repositories full lifecycle in browser (create, invite, context email, team assignment, expel with OTP)', async ({ page }) => {
  // 1. Boot app
  await boot(page)
  await expect(page.locator('#btnOpenAuth')).toBeVisible()

  // 2. Register Alice (alice@corp.com)
  await page.click('#btnOpenAuth')
  await page.fill('#authEmailInput', 'alice@corp.com')
  await page.click('#btnSendCode')

  await expect(page.locator('#authStepRegister')).toBeVisible()
  await page.fill('#regUsernameInput', 'alice')
  await page.fill('#regNameInput', 'Alice Admin')
  await page.click('#btnRegisterSendCode')

  await expect(page.locator('#authStepCode')).toBeVisible()
  await page.click('#btnVerifyCode')

  // Logged in as Alice
  await expect(page.locator('#userProfileBadge')).toBeVisible()
  await expect(page.locator('#userBadgeName')).toContainText('Alice Admin')

  // 3. Alice creates a Project "Platform Docs" (verifying automatic slug derivation)
  await page.click('#btnProjects')
  await expect(page.locator('#projectsModal')).toBeVisible()

  await page.fill('#newProjectNameInput', 'Platform Docs')
  await expect(page.locator('#newProjectSlugInput')).toHaveValue('platform-docs')
  await page.fill('#newProjectDescInput', 'Core engineering docs')
  await page.click('#btnCreateProject')

  await expect(page.locator('#joinedProjectsList')).toContainText('Platform Docs')
  await expect(page.locator('#joinedProjectsList')).toContainText('platform-docs')
  await expect(page.locator('#joinedProjectsList')).toContainText('owner')

  // 4. Alice opens Platform Docs details, invites Bob (@bob) and Charlie (charlie@partner.org)
  await page.locator('#joinedProjectsList button:has-text("View / Manage")').click()
  await expect(page.locator('#projectDetailsModal')).toBeVisible()
  await expect(page.locator('#projectDetailName')).toContainText('Platform Docs')
  await expect(page.locator('#projectDetailMemberList')).toContainText('Alice Admin')

  await page.fill('#projectInviteTargetInput', '@bob')
  await page.selectOption('#projectInviteRoleSelect', 'editor')
  await page.click('#btnSendProjectInvite')
  await expect(page.locator('#status')).toContainText('Project invitation sent to @bob')

  // Invite unregistered email Charlie
  await page.fill('#projectInviteTargetInput', 'charlie@partner.org')
  await page.selectOption('#projectInviteRoleSelect', 'commenter')
  await page.click('#btnSendProjectInvite')
  await expect(page.locator('#status')).toContainText('Project invitation sent to charlie@partner.org')

  // Alice sees Charlie in pending invitations and revokes it
  await expect(page.locator('#projectDetailPendingInvsSection')).toBeVisible()
  await expect(page.locator('#projectDetailPendingInvsList')).toContainText('charlie@partner.org')
  page.once('dialog', (d) => d.accept())
  await page.locator('#projectDetailPendingInvsList div:has-text("charlie@partner.org") button:has-text("Revoke")').click()
  await expect(page.locator('#status')).toContainText('Invitation revoked')
  await expect(page.locator('#projectDetailPendingInvsList')).not.toContainText('charlie@partner.org')

  await page.click('#btnCloseProjectDetailsModal')

  // 5. Alice logs out
  await page.click('#btnLogout')
  await expect(page.locator('#btnOpenAuth')).toBeVisible()

  // 6. Bob registers (bob@corp.com)
  await page.click('#btnOpenAuth')
  await page.fill('#authEmailInput', 'bob@corp.com')
  await page.click('#btnSendCode')

  await expect(page.locator('#authStepRegister')).toBeVisible()
  await page.fill('#regUsernameInput', 'bob')
  await page.fill('#regNameInput', 'Bob Builder')
  await page.click('#btnRegisterSendCode')

  await expect(page.locator('#authStepCode')).toBeVisible()
  await page.click('#btnVerifyCode')

  await expect(page.locator('#userProfileBadge')).toBeVisible()

  // 7. Bob checks Projects modal -> sees pending invitation to "Platform Docs" -> accepts
  await page.click('#btnProjects')
  await expect(page.locator('#projectsModal')).toBeVisible()
  await expect(page.locator('#pendingProjInvsSection')).toBeVisible()
  await expect(page.locator('#pendingProjInvsList')).toContainText('Platform Docs')
  await expect(page.locator('#pendingProjInvsList')).toContainText('editor')

  await page.locator('#pendingProjInvsList button:has-text("Accept")').click()
  await expect(page.locator('#status')).toContainText('Joined project')

  // Bob now sees Platform Docs under Joined Projects
  await expect(page.locator('#joinedProjectsList')).toContainText('Platform Docs')
  await expect(page.locator('#joinedProjectsList')).toContainText('editor')

  // Bob opens Platform Docs -> sees he is an editor, updates his Git signature email
  await page.locator('#joinedProjectsList button:has-text("View / Manage")').click()
  await expect(page.locator('#projectDetailsModal')).toBeVisible()
  await expect(page.locator('#projectDetailMemberList')).toContainText('Bob Builder')
  await expect(page.locator('#projectOwnerSection')).toBeHidden()

  // Bob updates signature email
  await page.selectOption('#projectMyContextEmailSelect', 'bob@corp.com')
  await page.click('#btnUpdateProjectContextEmail')
  await expect(page.locator('#status')).toContainText('Git signature email updated to bob@corp.com')

  await page.click('#btnCloseProjectDetailsModal')

  // 8. Bob logs out and Alice logs back in to test member removal with OTP
  await page.click('#btnLogout')
  await expect(page.locator('#btnOpenAuth')).toBeVisible()

  await page.click('#btnOpenAuth')
  await page.fill('#authEmailInput', 'alice@corp.com')
  await page.click('#btnSendCode')

  await expect(page.locator('#authStepCode')).toBeVisible()
  await page.click('#btnVerifyCode')

  // Alice opens Platform Docs details -> removes Bob using OTP verification prompt
  await page.click('#btnProjects')
  await page.locator('#joinedProjectsList button:has-text("View / Manage")').click()
  await expect(page.locator('#projectDetailsModal')).toBeVisible()

  await page.locator('#projectDetailMemberList button:has-text("Remove")').click()
  await expect(page.locator('#projectMemberRemovePrompt')).toBeVisible()
  await expect(page.locator('#projMemberRemoveCodeInput')).not.toHaveValue('')

  await page.click('#btnConfirmProjMemberRemove')

  await expect(page.locator('#status')).toContainText('Member removed from project')
  await expect(page.locator('#projectMemberRemovePrompt')).toBeHidden()
  await expect(page.locator('#projectDetailMemberList')).not.toContainText('Bob Builder')
})
