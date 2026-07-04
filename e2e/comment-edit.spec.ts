import { test, expect } from '@playwright/test'
import { boot, openReview, leaveComment, seedDoc } from './helpers'

/**
 * Edit own comment: the author can edit a comment while it has no replies. After saving, the body is
 * replaced. Uses its own seeded doc so it's isolated in the shared repo.
 */

test('edit your own comment body', async ({ page }) => {
  await seedDoc(page, 'e2e-comment-edit.md')
  await boot(page)
  await openReview(page, 'e2e-comment-edit.md')

  const card = await leaveComment(page, { body: 'Original body e2e' })
  const id = await card.getAttribute('data-id')

  await card.locator('button[data-act="edit"]').click()
  const edit = page.locator('#ebody')
  await expect(edit).toBeVisible()
  await edit.fill('Updated body e2e')
  await page.click('#esave')

  const byId = page.locator(`#cmtList .cmt[data-id="${id}"]`)
  await expect(byId).toContainText('Updated body e2e')
  await expect(byId).not.toContainText('Original body e2e')
})
