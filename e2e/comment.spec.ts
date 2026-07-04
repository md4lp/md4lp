import { test, expect } from '@playwright/test'
import { boot, openReview, leaveComment, seedDoc } from './helpers'

/**
 * Comment-flow smoke — the heart of md4lp: select text in Review → popover → Comment → the anchored
 * comment persists and shows in the sidebar, exercising the selection→offset anchoring + write path
 * end-to-end. Uses its own seeded doc so it's isolated from other comment specs in the shared repo.
 */

test('select text and leave an anchored comment', async ({ page }) => {
  await seedDoc(page, 'e2e-comment.md')
  await boot(page)
  await openReview(page, 'e2e-comment.md')

  const card = await leaveComment(page, { body: 'Nice intro — clear and welcoming 👍' })
  await expect(card.locator('.q')).toContainText('The quick') // anchored to the selected text

  await page.screenshot({ path: 'test-results/comment.png', fullPage: true })
})
