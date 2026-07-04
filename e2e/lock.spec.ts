import { test, expect } from '@playwright/test'
import { boot, openReview, acquireEdit, seedDoc, waitForLive } from './helpers'

/**
 * Edit lock (D20): one editor at a time. While alice holds the lock, a second editor (agent-claude) is
 * refused with a banner. After alice goes idle past the timeout (e2e: MD4LP_LOCK_TIMEOUT_MS=3000), the
 * second editor takes over, and alice is bumped to read-only via an SSE lock event. Two independent
 * browser contexts so each keeps its own identity/session (switching #user in one tab would release).
 */

test('one editor at a time, with idle takeover and bump', async ({ browser }) => {
  const aliceCtx = await browser.newContext()
  const agentCtx = await browser.newContext()
  const alice = await aliceCtx.newPage()
  const agent = await agentCtx.newPage()

  await seedDoc(alice, 'e2e-lock.md')
  await boot(alice) // alice (editor)
  await openReview(alice, 'e2e-lock.md')
  await waitForLive(alice) // alice must be subscribed to receive the takeover (bump) event
  await boot(agent, 'agent-claude') // a second editor
  await openReview(agent, 'e2e-lock.md')

  // alice takes the lock and enters the editor.
  await acquireEdit(alice)

  // agent tries to edit while alice holds a fresh lock → refused with a banner, no editor mounted.
  await agent.click('#btnEdit')
  await expect(agent.locator('#status')).toContainText('alice is editing')
  await expect(agent.locator('#edit .ProseMirror')).toHaveCount(0)

  // alice goes idle past the lock timeout → agent can take over.
  await agent.waitForTimeout(3500)
  await acquireEdit(agent)

  // alice is bumped to read-only via the SSE lock event (she did not interact): the editor is gone and
  // she now watches agent-claude's live session.
  await expect(alice.locator('#edit')).toBeHidden()
  await expect(alice.locator('#status')).toContainText('agent-claude is editing')

  await aliceCtx.close()
  await agentCtx.close()
})
