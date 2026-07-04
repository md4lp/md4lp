import { test, expect } from '@playwright/test'
import { boot, openReview } from './helpers'

/**
 * In-document search: typing in the search box highlights matches (CSS Custom Highlight API, not DOM
 * nodes) and the counter reflects "current/total"; Enter steps to the next match; a miss shows "no
 * matches". We assert on #searchCount (the observable) rather than the highlight ranges.
 */

test('search counts matches and steps through them', async ({ page }) => {
  await boot(page)
  await openReview(page, 'reading-demo.md')

  const count = page.locator('#searchCount')

  // A term that occurs at least once → "1/N".
  await page.locator('#search').fill('Review')
  await expect(count).toHaveText(/^\d+\/\d+$/)

  // A miss → explicit "no matches".
  await page.locator('#search').fill('qqqzzzxx')
  await expect(count).toHaveText('no matches')

  // A common letter → many matches; Enter advances current index 1 → 2.
  await page.locator('#search').fill('e')
  await expect(count).toHaveText(/^1\/\d+$/)
  await page.locator('#search').press('Enter')
  await expect(count).toHaveText(/^2\/\d+$/)
})
