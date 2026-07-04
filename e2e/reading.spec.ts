import { test, expect } from '@playwright/test'
import { boot, openReview, waitForOutline } from './helpers'

/**
 * Reading-view smoke: opens the reading-demo doc in Review and asserts the Tier 1/2 polish actually
 * renders (syntax highlighting, KaTeX, outline). Screenshots are written unconditionally (light + dark)
 * so the layout can be eyeballed from a passing run via Read on the PNG.
 */

test('reading-demo renders highlighting, math and outline', async ({ page }) => {
  await boot(page)
  await openReview(page, 'reading-demo.md')
  await expect(page.locator('#review h1')).toHaveText('Reading demo')

  // Syntax highlighting (rehype-highlight → highlight.js classes on the fenced TS block).
  await expect(page.locator('#review pre code.hljs')).toHaveCount(1)

  // Math (remark-math + rehype-katex): inline $E=mc^2$, inline sum, and the $$…$$ block.
  expect(await page.locator('#review .katex').count()).toBeGreaterThanOrEqual(2)

  // Outline (post-fetch render pass) — also gates the screenshot on a fully-rendered Review.
  await waitForOutline(page)
  await page.screenshot({ path: 'test-results/reading-light.png', fullPage: true })
})

test('reading-demo renders in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await boot(page)
  await openReview(page, 'reading-demo.md')
  await waitForOutline(page)
  await page.screenshot({ path: 'test-results/reading-dark.png', fullPage: true })
})
