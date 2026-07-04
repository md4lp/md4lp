import { test, expect } from '@playwright/test'
import { boot, openReview, leaveComment, seedDoc } from './helpers'

/**
 * Emoji reactions: clicking a reaction chip on a comment records the current user's reaction — the chip
 * gets the "mine" state and a count. Uses its own seeded doc so it's isolated in the shared repo.
 */

test('react to a comment with an emoji', async ({ page }) => {
  await seedDoc(page, 'e2e-react.md')
  await boot(page)
  await openReview(page, 'e2e-react.md')

  await leaveComment(page, { body: 'React-target comment e2e' })
  const card = page.locator('#cmtList .cmt[data-id]', { hasText: 'React-target comment e2e' })
  await card.locator('button.rx[data-emoji="👍"]').click()

  // After the round-trip + re-render, the 👍 chip is "mine" and shows a count of 1.
  const chip = page
    .locator('#cmtList .cmt[data-id]', { hasText: 'React-target comment e2e' })
    .locator('button.rx[data-emoji="👍"]')
  await expect(chip).toHaveClass(/mine/)
  await expect(chip).toContainText('1')
})
