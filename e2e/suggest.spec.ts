import { test, expect } from '@playwright/test'
import { boot, openReview, selectInReview, seedDoc } from './helpers'

/**
 * Suggest → approve flow: a reviewer proposes a replacement for some text; the editor approves and the
 * change is applied to the actual .md (committed to main, D20). Uses its own seeded doc — approval now
 * mutates main, so it must not share a doc with other specs (order-independence).
 */

test('suggest a replacement and approve it (text changes in the doc)', async ({ page }) => {
  await seedDoc(page, 'e2e-suggest.md') // intro paragraph: "The quick brown fox jumps over the lazy dog."
  await boot(page)
  await openReview(page, 'e2e-suggest.md')

  // Select the leading "The" of the intro paragraph and open the Suggest composer.
  await selectInReview(page, 'p', 3)
  await page.locator('#popover button[data-act="suggest"]').click()

  // The proposal box is prefilled with the quote; replace it. (Body/"why" is optional for suggestions.)
  const prop = page.locator('#cprop')
  await expect(prop).toBeVisible()
  await prop.fill('EDITED')
  await page.click('#csave')

  // The suggestion card shows "old → new" and, for an editor, Approve/Reject.
  const card = page.locator('#cmtList .cmt[data-id]', { hasText: 'EDITED' })
  await expect(card.locator('.sug')).toContainText('EDITED')
  await expect(card.locator('button[data-act="approve"]')).toBeVisible()

  // Approve → the .md is rewritten: the paragraph now starts with the replacement.
  await card.locator('button[data-act="approve"]').click()
  await expect(page.locator('#review')).toContainText('EDITED quick brown fox')
})
