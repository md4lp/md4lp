import { test, expect } from '@playwright/test'
import { boot, openReview, acquireEdit, seedDoc } from './helpers'

/**
 * Edit-view smoke (D20): everyone boots into Review. An editor clicks Edit to acquire the lock and mount
 * the Crepe/Milkdown WYSIWYG; Publish is then available. Uses its own seeded doc so it's isolated.
 */

test('editor acquires the lock via Edit and enters the Crepe WYSIWYG', async ({ page }) => {
  await seedDoc(page, 'e2e-edit.md')
  await boot(page)
  await openReview(page, 'e2e-edit.md') // default view is Review

  // Edit acquires the lock and mounts the editor with the doc content.
  await acquireEdit(page)
  await expect(page.locator('#edit .ProseMirror')).toContainText('E2E fixture')

  // While editing, Publish is available; there is no separate "Save draft" button (auto-save).
  await expect(page.locator('#btnMerge')).toBeVisible()
  await expect(page.locator('#btnSave')).toHaveCount(0)

  await page.screenshot({ path: 'test-results/edit-light.png', fullPage: true })
})
