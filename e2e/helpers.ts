import { expect, type Page } from '@playwright/test'

/**
 * Shared drivers for the md4lp e2e smokes. The app has no router/login form — identity is the `#user`
 * select and the doc is the `#file` select; boot() populates both once the server answers, which is our
 * "ready" signal. Keep these helpers thin: they get the app into a known state, specs do the asserting.
 */

/**
 * Seed a fresh document on `main` via the API so a test can operate on it in isolation — the e2e repo
 * is shared across the run, so tests that mutate comments/text must each use their own doc to stay
 * order-independent. Returns the path. Call before boot() (boot lists main's files).
 *
 * D20: writes flow through the edit lock, so seeding is a self-contained edit turn —
 * acquire → PUT (edit branch) → release (consolidate to main). After this the doc lives on main and is
 * commentable (no active lock).
 */
export async function seedDoc(
  page: Page,
  path: string,
  opts: { user?: string; content?: string } = {},
): Promise<string> {
  const content = opts.content ?? '# E2E fixture\n\nThe quick brown fox jumps over the lazy dog.\n'
  const params = { user: opts.user ?? 'alice', path }
  const acquire = await page.request.post('/api/lock/acquire', { params })
  expect(acquire.ok(), `seedDoc acquire ${path}: ${acquire.status()} ${await acquire.text()}`).toBeTruthy()
  const put = await page.request.put('/api/file', { params, data: { content, message: `seed e2e fixture ${path}` } })
  expect(put.ok(), `seedDoc put ${path}: ${put.status()} ${await put.text()}`).toBeTruthy()
  const release = await page.request.post('/api/lock/release', { params })
  expect(release.ok(), `seedDoc release ${path}: ${release.status()} ${await release.text()}`).toBeTruthy()
  return path
}

/** Click Edit to acquire the lock and mount the WYSIWYG; resolves once the editor is interactable. */
export async function acquireEdit(page: Page): Promise<void> {
  await page.click('#btnEdit')
  await expect(page.locator('#edit .ProseMirror')).toBeVisible()
}

/**
 * Load the app as `user` (identity comes from the ?user= query param; defaults to alice) and wait for
 * boot() to populate the user list. Loading with the param gives each identity a clean, race-free boot.
 */
export async function boot(page: Page, user?: string): Promise<void> {
  await page.goto(user ? `/?user=${encodeURIComponent(user)}` : '/')
  await expect(page.locator('#user option')).not.toHaveCount(0)
  if (user) await expect(page.locator('#user')).toHaveValue(user)
}

/** Wait until the page's SSE stream is connected (so events emitted after this won't be missed). */
export async function waitForLive(page: Page): Promise<void> {
  await expect(page.locator('body[data-live="on"]')).toBeAttached()
}

/**
 * Open a file in the Review view. Waits for the rendered body (#review h1) — renderReview() sets the
 * whole innerHTML (headings, paragraphs, highlighted code, KaTeX) synchronously, so all of that is
 * present once the h1 is. NOTE: the outline (renderToc), highlight re-anchoring and the comments
 * sidebar run AFTER an awaited comments fetch — for those, wait on their own markers in the spec
 * (e.g. waitForReviewFullyRendered) rather than assuming they're up when the body is.
 */
export async function openReview(page: Page, file: string): Promise<void> {
  await page.selectOption('#file', file)
  await page.click('#btnReview')
  await expect(page.locator('#review h1')).not.toHaveCount(0)
  // renderReview() sets the body synchronously (so the h1 is up) but then AWAITS a comments fetch before
  // running renderSidebar()/renderToc(). If we interact before that tail completes, the late
  // renderSidebar() re-renders and clobbers an open composer (its #cbody/#csave get replaced) → a
  // silent empty-body save. Wait for the sidebar to settle (it always paints the "Select text…" hint or
  // the existing comments) so the render is fully done before any spec drives the comment flow.
  await expect(page.locator('#cmtList')).not.toBeEmpty()
}

/**
 * Wait for the post-fetch render pass to finish (outline + sidebar). Only valid for docs with ≥2
 * headings, which is when renderToc() emits .toc-item entries. Use before screenshotting a multi-
 * heading doc so the capture isn't missing the outline.
 */
export async function waitForOutline(page: Page): Promise<void> {
  await expect(page.locator('#toc .toc-item')).not.toHaveCount(0)
}

/**
 * Select `len` characters from the start of the first text node of `selector` inside #review, then fire
 * the mouseup the app listens for. selectionToOffsets() maps the range back to .md offsets via the
 * data-s/data-e stamps, so the comment popover appears anchored to that block.
 */
export async function selectInReview(page: Page, selector: string, len: number): Promise<void> {
  await page.evaluate(
    ({ selector, len }) => {
      const el = document.querySelector(`#review ${selector}`)
      const node = el?.firstChild
      if (!node) throw new Error(`no text node for #review ${selector}`)
      const range = document.createRange()
      range.setStart(node, 0)
      range.setEnd(node, len)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.querySelector('#review')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    },
    { selector, len },
  )
  await expect(page.locator('#popover')).toBeVisible()
}

/**
 * Full "leave a comment" flow from inside the Review view: select text → popover → Comment → write →
 * save → return the resulting card (located by its unique body so it's robust to other comments that
 * may already exist in the shared e2e repo). Use a unique `body` per test.
 */
export async function leaveComment(
  page: Page,
  opts: { selector?: string; len?: number; body: string },
): Promise<ReturnType<Page['locator']>> {
  await selectInReview(page, opts.selector ?? 'p', opts.len ?? 10)
  await page.locator('#popover button[data-act="comment"]').click()
  const ta = page.locator('#cbody')
  await expect(ta).toBeVisible()
  await ta.fill(opts.body)
  // Gate the save on the value actually being committed to the live textarea — the #csave handler reads
  // bodyEl.value, and saveComposer drops empty-body comments, so a fill that hasn't landed yields a
  // silent no-op (intermittent in the full suite). toHaveValue retries until the current element holds it.
  await expect(ta).toHaveValue(opts.body)
  await page.click('#csave')
  await expect(ta).toHaveCount(0) // composer closed → save round-trip done
  const card = page.locator('#cmtList .cmt[data-id]', { hasText: opts.body })
  await expect(card).toHaveCount(1)
  return card
}
