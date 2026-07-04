import { test, expect } from '@playwright/test'
import { boot, openReview, leaveComment, seedDoc } from './helpers'

/**
 * Threaded reply: leave a comment, then reply to it; the reply renders nested under the comment with
 * the replier's name. Uses its own seeded doc so it's isolated in the shared repo.
 */

test('reply to a comment (nested thread)', async ({ page }) => {
  await seedDoc(page, 'e2e-reply.md')
  await boot(page)
  await openReview(page, 'e2e-reply.md')

  const card = await leaveComment(page, { body: 'Reply-target comment e2e' })
  await card.locator('button[data-act="reply"]').click()

  const reply = page.locator('#rbody')
  await expect(reply).toBeVisible()
  await reply.fill('Agreed — shipping it 🚀')
  await page.click('#rsave')

  // The reply lands nested in the same card, attributed to alice.
  const updated = page.locator('#cmtList .cmt[data-id]', { hasText: 'Reply-target comment e2e' })
  await expect(updated.locator('.reply')).toContainText('alice:')
  await expect(updated.locator('.reply')).toContainText('Agreed — shipping it')
})
