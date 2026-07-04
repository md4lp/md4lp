import { test, expect } from '@playwright/test'
import { boot, openReview, acquireEdit, seedDoc } from './helpers'

/**
 * Auto-save (D20): while editing, typing is debounced and committed to the ephemeral edit branch with no
 * "Save" button. This asserts the content is persisted to the live version BEFORE publishing, and that
 * the lock is still held by the editor (distinct from publish.spec, which then consolidates to main).
 */

test('typing auto-saves to the live edit branch (before publishing)', async ({ page }) => {
  await seedDoc(page, 'e2e-autosave.md')
  await boot(page)
  await openReview(page, 'e2e-autosave.md')

  await acquireEdit(page)
  await page.locator('#edit .ProseMirror').click()
  await page.keyboard.type(' autosaved-marker')
  await expect(page.locator('#status')).toContainText('Saved', { timeout: 5000 })

  // The live version (edit branch, since alice holds the lock) already has the text — without publishing.
  const res = await page.request.get('/api/file', { params: { user: 'alice', path: 'e2e-autosave.md' } })
  const body = (await res.json()) as { content: string; lock: { editor: string | null } }
  expect(body.content).toContain('autosaved-marker')
  expect(body.lock.editor).toBe('alice') // still mid-session, not yet consolidated to main
})
