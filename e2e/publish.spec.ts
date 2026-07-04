import { test, expect } from '@playwright/test'
import { boot, openReview, acquireEdit, seedDoc } from './helpers'

/**
 * Auto-save → Publish (D20): an editor enters the WYSIWYG (acquiring the lock), types — which auto-saves
 * to the ephemeral edit branch — then Publishes (releases the lock → consolidates to main). Asserts the
 * status line confirms the save and the publish, and that the typed text survives on main. Own seeded doc.
 */

test('typing auto-saves, then Publish consolidates to main', async ({ page }) => {
  await seedDoc(page, 'e2e-publish.md')
  await boot(page)
  await openReview(page, 'e2e-publish.md')

  await acquireEdit(page)
  const pm = page.locator('#edit .ProseMirror')
  await pm.click()
  await page.keyboard.type(' e2e-published-marker')

  // Auto-save fires after the debounce window → the status line confirms it.
  await expect(page.locator('#status')).toContainText('Saved', { timeout: 5000 })

  // Publish releases the lock and consolidates the edit branch to main → back in Review.
  await page.click('#btnMerge')
  await expect(page.locator('#status')).toContainText('to main')
  await expect(page.locator('#review')).toContainText('e2e-published-marker')
})
