import { test, expect } from '@playwright/test'
import { boot, openReview } from './helpers'

/**
 * Reading text zoom: A+/A− adjust the Review font size (inline style on #review, clamped 11–26px,
 * default 15). Assert the inline font-size moves up on zoom-in and back down on zoom-out.
 */

const fontPx = (page: import('@playwright/test').Page) =>
  page.locator('#review').evaluate((el) => (el as HTMLElement).style.fontSize)

test('A+/A− change the reading font size', async ({ page }) => {
  await boot(page)
  await openReview(page, 'reading-demo.md')

  await page.click('#zoomIn') // 15 → 16
  await expect.poll(() => fontPx(page)).toBe('16px')

  await page.click('#zoomOut') // 16 → 15
  await page.click('#zoomOut') // 15 → 14
  await expect.poll(() => fontPx(page)).toBe('14px')
})
