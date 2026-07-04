import { test, expect } from '@playwright/test'
import { boot } from './helpers'

/**
 * Role smoke: bob is a commenter (DEFAULT_CONFIG). A commenter boots into Review with no Edit/Publish
 * affordances — they review and comment, they don't edit the document.
 */

test('commenter boots into Review with no write affordances', async ({ page }) => {
  await boot(page, 'bob')

  // Lands in Review, not the editor.
  await expect(page.locator('#reviewWrap')).toBeVisible()
  await expect(page.locator('#edit')).toBeHidden()

  // No Edit / Publish for a commenter.
  await expect(page.locator('#btnEdit')).toBeHidden()
  await expect(page.locator('#btnMerge')).toBeHidden()

  await page.screenshot({ path: 'test-results/commenter.png', fullPage: true })
})
