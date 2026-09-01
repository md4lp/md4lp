import { test, expect } from '@playwright/test'
import { boot } from './helpers'

test('full authentication and account lifecycle in browser', async ({ page }) => {
  await boot(page)

  // 1. Initial state: unauthenticated, Sign in button visible
  const btnOpenAuth = page.locator('#btnOpenAuth')
  await expect(btnOpenAuth).toBeVisible()
  await expect(btnOpenAuth).toHaveText('Sign in (Email/Username OTP)')

  // 2. Open login modal
  await btnOpenAuth.click()
  const authModal = page.locator('#authModal')
  await expect(authModal).toBeVisible()

  // 3. Fill in email to check/start registration
  await page.locator('#authEmailInput').fill('tester.alice@example.com')
  await page.locator('#btnSendCode').click()

  // 3.5. Registration step is shown: enter chosen username and display name
  await expect(page.locator('#authStepRegister')).toBeVisible()
  await expect(page.locator('#regEmailInput')).toHaveValue('tester.alice@example.com')
  await page.locator('#regUsernameInput').fill('tester.alice')
  await page.locator('#regNameInput').fill('Alice Tester')
  await page.locator('#btnRegisterSendCode').click()

  // 4. Verification step is shown with dev code helper
  await expect(page.locator('#authStepCode')).toBeVisible()
  const authDevHelper = page.locator('#authDevHelper')
  await expect(authDevHelper).toBeVisible()
  const helperText = await authDevHelper.textContent()
  expect(helperText).toContain('[Dev mode] Your single-use code is:')

  // In dev mode, the input is autofilled or we can read it
  const codeInput = page.locator('#authCodeInput')
  await expect(codeInput).not.toHaveValue('')

  // 5. Verify & Log In
  await page.locator('#btnVerifyCode').click()
  await expect(authModal).not.toBeVisible()

  // 6. Header updates with authenticated profile badge
  const userBadge = page.locator('#userProfileBadge')
  await expect(userBadge).toBeVisible()
  await expect(page.locator('#userBadgeName')).toContainText('Alice Tester')
  await expect(btnOpenAuth).not.toBeVisible()

  // 7. Open Account Management Modal
  await page.locator('#btnManageAccount').click()
  const accountModal = page.locator('#accountModal')
  await expect(accountModal).toBeVisible()
  await expect(page.locator('#accUserName')).toHaveText('Alice Tester')

  // 8. Add a secondary email (unverified / pending)
  const addEmailInput = page.locator('#addEmailInput')
  await addEmailInput.fill('alice.work@corp.com')
  await page.locator('#btnSendAddCode').click()

  // Verify that the email is immediately listed as Pending Verification
  const pendingItem = page.locator('.email-item', { hasText: 'alice.work@corp.com' })
  await expect(pendingItem).toBeVisible()
  await expect(pendingItem.locator('.badge-pending')).toHaveText('⏳ Pending Verification')

  // 9. Close and reopen account modal -> pending email persists!
  await page.locator('#btnCloseAccountModal').click()
  await expect(accountModal).not.toBeVisible()

  await page.locator('#btnManageAccount').click()
  await expect(accountModal).toBeVisible()
  const pendingItemReopened = page.locator('.email-item', { hasText: 'alice.work@corp.com' })
  await expect(pendingItemReopened).toBeVisible()
  await expect(pendingItemReopened.locator('.badge-pending')).toHaveText('⏳ Pending Verification')

  // 10. Resend code & verify pending email inline
  await pendingItemReopened.locator('.btnResendCode').click()
  await expect(pendingItemReopened.locator('.dev-helper')).toBeVisible()

  // Click Confirm on the pending verification
  await pendingItemReopened.locator('.btnSubmitPendingVerify').click()

  // Verified badge appears!
  const verifiedItem = page.locator('.email-item', { hasText: 'alice.work@corp.com' })
  await expect(verifiedItem.locator('text=✓ Verified')).toBeVisible()

  // 11. Make the secondary email primary
  await verifiedItem.locator('.btnMakePrimary').click()
  await expect(verifiedItem.locator('.badge-primary')).toHaveText('Primary')

  // 12. Edit profile (update display name & avatar)
  await page.locator('summary', { hasText: 'Edit Profile' }).click()
  await page.locator('#accEditName').fill('Alice Chief')
  await page.locator('#accEditAvatar').fill('https://api.dicebear.com/7.x/bottts/svg?seed=Alice')
  await page.locator('#btnSaveProfile').click()

  await expect(page.locator('#accUserName')).toHaveText('Alice Chief')
  await page.locator('#btnCloseAccountModal').click()
  await expect(page.locator('#userBadgeName')).toContainText('Alice Chief')
  await expect(page.locator('#userBadgeAvatar')).toBeVisible()

  // 13. Logout
  await page.locator('#btnLogout').click()
  await expect(userBadge).not.toBeVisible()
  await expect(btnOpenAuth).toBeVisible()

  // 14. Log back in using USERNAME instead of email
  await btnOpenAuth.click()
  await expect(authModal).toBeVisible()
  await page.locator('#authEmailInput').fill('tester.alice') // username
  await page.locator('#btnSendCode').click()

  await expect(page.locator('#authStepCode')).toBeVisible()
  await expect(page.locator('#authTargetEmail')).toHaveText('alice.work@corp.com') // primary email
  await page.locator('#btnVerifyCode').click()

  // Successfully logged in!
  await expect(userBadge).toBeVisible()
  await expect(page.locator('#userBadgeName')).toContainText('Alice Chief')
})
