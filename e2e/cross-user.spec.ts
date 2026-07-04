import { test, expect } from '@playwright/test'
import { boot, openReview, leaveComment } from './helpers'

/**
 * D17 Model A — cross-user comment visibility. A comment lives on its creator's branch; the server
 * aggregates across branches so other users see it. Here alice comments on scope.md, then bob (a
 * different user) opens the same doc and should see alice's comment. Uses scope.md exclusively so no
 * other spec's comments interfere.
 */

test("a comment by one user is visible to another (aggregation)", async ({ page }) => {
  const marker = 'Cross-user visibility marker e2e'

  await boot(page) // alice (editor)
  await openReview(page, 'scope.md')
  await leaveComment(page, { selector: 'h1', len: 5, body: marker }) // anchor on "Scope"

  // Switch to bob (commenter) — fresh load — and open the same doc in Review.
  await boot(page, 'bob')
  await openReview(page, 'scope.md')

  // bob sees alice's comment, attributed to alice.
  const card = page.locator('#cmtList .cmt[data-id]', { hasText: marker })
  await expect(card).toHaveCount(1)
  await expect(card.locator('.meta')).toContainText('alice')
})
