import { test, expect } from '@playwright/test'
import { boot, openReview, seedDoc, waitForLive } from './helpers'

/**
 * Live propagation (D20): the Review view subscribes to server-sent events and refreshes without a
 * reload. Here a watcher (bob) has a doc open; another user posts a comment via the API; bob's sidebar
 * updates live. This exercises the SSE channel end-to-end (server EventBus → /api/events → client).
 */

test("another user's comment appears live, without reload (SSE)", async ({ page }) => {
  await seedDoc(page, 'e2e-live.md')
  await boot(page, 'bob') // a commenter, watching
  await openReview(page, 'e2e-live.md')
  await waitForLive(page) // ensure the SSE stream is connected before the other user posts

  const marker = 'Live SSE comment marker'
  const card = page.locator('#cmtList .cmt[data-id]', { hasText: marker })
  await expect(card).toHaveCount(0) // nothing yet

  // alice posts a comment via the API (simulating another session) — anchored to main.
  const res = await page.request.post('/api/comment', {
    params: { user: 'alice', path: 'e2e-live.md' },
    data: { start: 0, end: 5, body: marker },
  })
  expect(res.ok()).toBeTruthy()

  // bob's sidebar updates from the SSE event — no page reload.
  await expect(card).toHaveCount(1, { timeout: 5000 })
  await expect(card.locator('.meta')).toContainText('alice')
})
