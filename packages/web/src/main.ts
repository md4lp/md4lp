import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import 'katex/dist/katex.min.css'
import './review.css'
import { renderToHtml, selectionToOffsets, renderComment, htmlToMarkdown } from '@md4lp/render'
import type { FileResponse, LiveEvent, Reply, Sidecar, State } from './types'
import { findNodeBody } from './comment-tree'
import { locateRange, findAllRanges } from './highlight'
import { html, raw, type Html } from './markup'

// md4lp web app. Edit view = Crepe WYSIWYG on wip/<user>. Review view = rendered HTML + a selection
// popover (Comment / Suggest change). Comments persist as YAML sidecars, anchored to the .md, and
// re-anchor across commits (intact/moved/orphaned). Editors can apply/reject suggestions. Clicking a
// comment scrolls to and flashes its anchor.

const REACTIONS = ['👍', '👎', '✅', '❌', '👀']
// D20 live-edit timings: debounce keystrokes before an auto-save commit; throttle lock heartbeats.
const AUTOSAVE_DEBOUNCE_MS = 1500
const HEARTBEAT_THROTTLE_MS = 5000

// Identity comes from the ?user= query param (falls back to alice). The #user select switches it by
// reloading with the new param, which keeps each identity's boot fully isolated (no interleaving).
let user = new URLSearchParams(window.location.search).get('user') ?? 'alice'
let role: 'editor' | 'commenter' = 'editor'
let file = ''
let currentView: 'edit' | 'review' = 'review'
let reviewMd = ''
let crepe: Crepe | null = null
// D20: who currently holds the edit lock on `file` (null = nobody). Drives the Edit button + comment gate.
let lockEditor: string | null = null
let events: EventSource | null = null
let autosaveTimer: ReturnType<typeof setTimeout> | undefined
let lastHeartbeatAt = 0
let selPending: { start: number; end: number; quote: string } | null = null
let composer: { mode: 'comment' | 'suggest'; start: number; end: number; quote: string } | null = null
let replyTo: { id: string; owner: string; parentBody: string } | null = null
let replyWarning: string | null = null
let replyDraft = ''
let editing: { id: string; owner: string } | null = null
let lastComments: Sidecar[] = []

const $ = <T extends HTMLElement>(s: string): T => document.querySelector<T>(s)!
const els = {
  edit: $<HTMLDivElement>('#edit'),
  reviewWrap: $<HTMLDivElement>('#reviewWrap'),
  review: $<HTMLDivElement>('#review'),
  toc: $<HTMLDivElement>('#toc'),
  search: $<HTMLInputElement>('#search'),
  searchCount: $<HTMLSpanElement>('#searchCount'),
  zoomIn: $<HTMLButtonElement>('#zoomIn'),
  zoomOut: $<HTMLButtonElement>('#zoomOut'),
  cmtList: $<HTMLDivElement>('#cmtList'),
  user: $<HTMLSelectElement>('#user'),
  file: $<HTMLSelectElement>('#file'),
  btnEdit: $<HTMLButtonElement>('#btnEdit'),
  btnReview: $<HTMLButtonElement>('#btnReview'),
  btnMerge: $<HTMLButtonElement>('#btnMerge'),
  status: $<HTMLSpanElement>('#status'),
  popover: $<HTMLDivElement>('#popover'),
}

async function api<T = unknown>(method: string, path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const q = new URLSearchParams({ user, ...(opts.query ?? {}) })
  let res: Response
  try {
    res = await fetch(`/api/${path}?${q.toString()}`, {
      method,
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new Error('Network error — is the md4lp server running?')
  }
  let json: { error?: string } & Record<string, unknown>
  try {
    json = await res.json()
  } catch {
    throw new Error(`Unexpected non-JSON response (HTTP ${res.status})`)
  }
  if (!res.ok) throw new Error(json.error ?? res.statusText)
  return json as T
}

const setStatus = (m: string): void => {
  els.status.textContent = m
}
/** Surface any action/fetch failure to the user instead of leaving the UI silently stuck. */
function reportError(e: unknown): void {
  console.error(e)
  setStatus(`⚠ ${e instanceof Error ? e.message : String(e)}`)
}
/** Run a top-level async action, routing any rejection through reportError (R1). */
const run = (fn: () => Promise<void>): void => {
  void fn().catch(reportError)
}

// ---------- boot / file / view ----------
async function boot(): Promise<void> {
  const state = await api<State>('GET', 'state')
  els.user.innerHTML = state.users.map((u) => `<option value="${u.id}">${u.id} (${u.role})</option>`).join('')
  els.user.value = user
  role = state.role
  els.file.innerHTML = state.files.map((f) => `<option value="${f}">${f}</option>`).join('')
  connectEvents() // (re)open the SSE stream for this user
  const [first] = state.files
  if (first) {
    file = first
    els.file.value = file
    await loadFile()
  }
}

/** Show a file in the default (Review) view: render it and refresh lock-driven UI. */
async function loadFile(): Promise<void> {
  await teardownCrepe()
  applyView('review')
  await renderReview() // sets reviewMd + lockEditor, repaints, and may set a "X is editing" banner
}

/** Reflect the current role/view/lock state on the toolbar buttons. */
function updateButtons(): void {
  const isEditor = role === 'editor'
  const editing = currentView === 'edit'
  els.btnEdit.style.display = isEditor && !editing ? '' : 'none'
  els.btnMerge.style.display = isEditor && editing ? '' : 'none' // "Publish" only while editing
  // Edit stays clickable even when another user holds the lock: the idle lock expires lazily, so a click
  // is what discovers whether a takeover is possible (server grants, or returns 409 → we show a banner).
  const blocked = lockEditor !== null && lockEditor !== user
  els.btnEdit.title = blocked ? `${lockEditor} is editing — click to take over once they're idle` : ''
}

/** Switch the visible pane (edit vs review) and sync button state. Does not touch the lock. */
function applyView(view: 'edit' | 'review'): void {
  currentView = view
  hidePopover()
  const editing = view === 'edit'
  els.edit.style.display = editing ? '' : 'none'
  els.reviewWrap.style.display = editing ? 'none' : 'flex'
  els.btnEdit.classList.toggle('active', editing)
  els.btnReview.classList.toggle('active', !editing)
  updateButtons()
}

// ---------- edit session (lock + auto-save) ----------
/** Acquire the edit lock and enter the WYSIWYG. One editor at a time (D20). */
async function enterEdit(): Promise<void> {
  if (role !== 'editor') return
  try {
    const res = await api<{ editor: string }>('POST', 'lock/acquire', { query: { path: file } })
    lockEditor = res.editor
  } catch (e) {
    if (isLockedError(e)) {
      await refreshLock()
      setStatus(`📝 ${lockEditor ?? 'someone'} is editing this document`)
      return
    }
    reportError(e)
    return
  }
  // Now that we hold the lock, GET /api/file serves the fresh edit branch (== main at acquire).
  const { content } = await api<FileResponse>('GET', 'file', { query: { path: file } })
  await mountCrepe(content)
  applyView('edit')
  lastHeartbeatAt = Date.now()
  setStatus(`Editing ${file} — changes auto-save`)
}

/** Leave the edit session. When `release`, flush the latest content and consolidate to main. */
async function exitEditView(release: boolean): Promise<void> {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer)
    autosaveTimer = undefined
  }
  let published = false
  if (release && lockEditor === user) {
    try {
      if (crepe) await api('PUT', 'file', { query: { path: file }, body: { content: crepe.getMarkdown(), message: `edit ${file}` } })
      await api('POST', 'lock/release', { query: { path: file } })
      published = true
    } catch (e) {
      reportError(e)
    }
  }
  lockEditor = null
  await teardownCrepe()
  await loadFile()
  if (published) setStatus(`✓ Published ${file} to main`) // after loadFile so it isn't overwritten
}

/** Called when the server tells us we no longer hold the lock (heartbeat/PUT 409, or an SSE lock event). */
function handleBump(): void {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer)
    autosaveTimer = undefined
  }
  setStatus('⚠ Editing was taken over — unsaved changes were discarded (auto-saved work is preserved).')
  void teardownCrepe().then(() => loadFile())
}

async function mountCrepe(content: string): Promise<void> {
  await teardownCrepe()
  const host = document.createElement('div')
  els.edit.appendChild(host)
  crepe = new Crepe({
    root: host,
    defaultValue: content,
    // The code-block's preview/source toggle is labelled "Edit" by default — relabel it: it shows the
    // LaTeX/code source, it doesn't "edit" in the document sense. (Config on Crepe's CodeMirror feature.)
    featureConfigs: {
      [Crepe.Feature.CodeMirror]: {
        previewToggleText: (previewOnly: boolean) => (previewOnly ? 'Show source' : 'Hide source'),
      },
    },
  })
  await crepe.create()
}

async function teardownCrepe(): Promise<void> {
  if (crepe) {
    try {
      await crepe.destroy()
    } catch {
      /* ignore */
    }
    crepe = null
  }
  els.edit.replaceChildren()
}

/** Editor interaction → debounce an auto-save commit AND send a throttled lock heartbeat. */
function onEditorInteraction(): void {
  if (currentView !== 'edit' || lockEditor !== user) return
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => run(autosave), AUTOSAVE_DEBOUNCE_MS)
  const now = Date.now()
  if (now - lastHeartbeatAt > HEARTBEAT_THROTTLE_MS) {
    lastHeartbeatAt = now
    void heartbeat()
  }
}

async function autosave(): Promise<void> {
  if (!crepe || currentView !== 'edit' || lockEditor !== user) return
  setStatus('Saving…')
  try {
    await api('PUT', 'file', { query: { path: file }, body: { content: crepe.getMarkdown(), message: `edit ${file}` } })
    setStatus('✓ Saved')
  } catch (e) {
    if (isLockedError(e)) return handleBump()
    reportError(e)
  }
}

async function heartbeat(): Promise<void> {
  if (lockEditor !== user) return
  try {
    await api('POST', 'lock/heartbeat', { query: { path: file } })
  } catch (e) {
    if (isLockedError(e)) handleBump()
  }
}

async function refreshLock(): Promise<void> {
  const { lock } = await api<FileResponse>('GET', 'file', { query: { path: file } })
  lockEditor = lock.editor
  updateButtons()
}

const isLockedError = (e: unknown): boolean => e instanceof Error && /being edited by/.test(e.message)

// ---------- live events (SSE) ----------
// Coalesce SSE-driven re-renders: never overlap two renderReview() passes, and never clobber an open
// composer/reply/edit (the render-race lesson). Pending renders flush once the pane is free.
let liveRendering = false
let liveRenderPending = false
function scheduleLiveRender(): void {
  if (currentView === 'edit') return
  if (composer || replyTo || editing || liveRendering) {
    liveRenderPending = true
    return
  }
  liveRendering = true
  liveRenderPending = false
  run(async () => {
    try {
      await renderReview()
    } finally {
      liveRendering = false
      if (liveRenderPending && !composer && !replyTo && !editing) scheduleLiveRender()
    }
  })
}

function connectEvents(): void {
  events?.close()
  const es = new EventSource(`/api/events?user=${encodeURIComponent(user)}`)
  es.onmessage = (ev) => {
    let e: LiveEvent
    try {
      e = JSON.parse(ev.data) as LiveEvent
    } catch {
      return
    }
    if (e.file !== file) return
    if (e.by === user) return // my own change — I already rendered locally; skip the echo
    if (e.type === 'lock') {
      lockEditor = e.editor ?? null
      // Someone else took the lock while I was editing → I'm bumped to read-only.
      if (currentView === 'edit' && lockEditor !== null && lockEditor !== user) return handleBump()
      updateButtons()
    }
    scheduleLiveRender() // doc/comments/lock from another user → refresh the live view
  }
  es.onopen = () => {
    document.body.dataset.live = 'on' // a test/visibility signal that the SSE stream is connected
  }
  es.onerror = () => {
    /* EventSource auto-reconnects; nothing to do */
  }
  events = es
}

async function renderReview(): Promise<void> {
  const { content, lock } = await api<FileResponse>('GET', 'file', { query: { path: file } })
  reviewMd = content
  lockEditor = lock.editor
  updateButtons()
  if (lockEditor && lockEditor !== user) setStatus(`📝 ${lockEditor} is editing this document (live)`)
  els.review.innerHTML = renderToHtml(content)
  addCopyButtons()
  const { comments } = await api<{ comments: Sidecar[] }>('GET', 'comments', { query: { path: file } })
  lastComments = comments
  paintHighlights()
  renderSidebar()
  renderToc()
  if (els.search.value.trim()) runSearch(els.search.value) // re-locate matches on the fresh DOM
}

// ---------- code blocks: copy button ----------
// The label comes from CSS (::after content), NOT a text node, so it never pollutes in-doc search or
// comment anchoring (which walk the rendered text).
function addCopyButtons(): void {
  for (const pre of els.review.querySelectorAll<HTMLPreElement>('pre')) {
    if (pre.querySelector('.copy-btn')) continue
    const code = pre.querySelector('code')
    if (!code) continue
    const btn = document.createElement('button')
    btn.className = 'copy-btn'
    btn.dataset.state = 'idle'
    btn.setAttribute('aria-label', 'Copy code')
    btn.addEventListener('click', () => {
      void navigator.clipboard
        .writeText(code.textContent ?? '')
        .then(() => {
          btn.dataset.state = 'done'
          setTimeout(() => (btn.dataset.state = 'idle'), 1200)
        })
        .catch(reportError)
    })
    pre.appendChild(btn)
  }
}

// ---------- table of contents ----------
// Build the "On this page" nav from the rendered headings (each carries an id from @md4lp/render).
function renderToc(): void {
  const headings = [...els.review.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')].filter((h) => h.id)
  if (headings.length < 2) {
    els.toc.innerHTML = '' // nothing worth navigating
    return
  }
  const items = headings.map((h) => html`<a class="toc-item toc-l${Number(h.tagName[1])}" data-id="${h.id}">${h.textContent ?? ''}</a>`)
  els.toc.innerHTML = html`<div class="toc-title">On this page</div>${items}`.value
  for (const a of els.toc.querySelectorAll<HTMLAnchorElement>('.toc-item')) {
    a.addEventListener('click', () => {
      els.review.querySelector(`#${CSS.escape(a.dataset.id!)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
}

// ---------- highlighting ----------
function setHighlight(name: string, ranges: Range[]): void {
  const cssAny = CSS as unknown as { highlights?: Map<string, unknown> }
  const HL = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
  if (cssAny.highlights && HL) cssAny.highlights.set(name, new HL(...ranges))
}

// Locate a comment by its source quote, falling back to the block at the re-anchored offset (R2).
const rangeFor = (c: Sidecar): Range | null => locateRange(els.review, c.comment.anchor.quote, c.resolution.start)

function paintHighlights(): void {
  const ranges: Range[] = []
  for (const c of lastComments) {
    if (c.resolution.status === 'orphaned' || c.comment.status === 'resolved') continue
    const r = rangeFor(c)
    if (r) ranges.push(r)
  }
  setHighlight('md4lp-comment', ranges)
}

function focusComment(c: Sidecar): void {
  const r = rangeFor(c)
  if (!r) return
  setHighlight('md4lp-focus', [r])
  r.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  setTimeout(() => setHighlight('md4lp-focus', []), 1400)
}

// ---------- in-doc search ----------
let searchRanges: Range[] = []
let searchIdx = 0

function runSearch(query: string): void {
  searchRanges = findAllRanges(els.review, query.trim())
  searchIdx = 0
  paintSearch(false)
}

function paintSearch(scroll: boolean): void {
  if (searchRanges.length === 0) {
    setHighlight('md4lp-search', [])
    setHighlight('md4lp-search-current', [])
    els.searchCount.textContent = els.search.value.trim() ? 'no matches' : ''
    return
  }
  const current = searchRanges[searchIdx]!
  setHighlight('md4lp-search', searchRanges.filter((_, i) => i !== searchIdx))
  setHighlight('md4lp-search-current', [current])
  els.searchCount.textContent = `${searchIdx + 1}/${searchRanges.length}`
  if (scroll) current.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function stepSearch(dir: number): void {
  if (searchRanges.length === 0) return
  searchIdx = (searchIdx + dir + searchRanges.length) % searchRanges.length
  paintSearch(true)
}

// ---------- text zoom (reading comfort) ----------
let reviewFontPx = 15
function setZoom(delta: number): void {
  reviewFontPx = Math.max(11, Math.min(26, reviewFontPx + delta))
  els.review.style.fontSize = `${reviewFontPx}px`
}

// ---------- selection popover ----------
function hidePopover(): void {
  els.popover.style.display = 'none'
}
function onReviewMouseUp(): void {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !els.review.contains(sel.anchorNode)) {
    hidePopover()
    selPending = null
    return
  }
  // Comments anchor to the consolidated `main` version (D20). While a doc is being edited live the
  // displayed text is the shifting edit branch, so commenting is paused until the editor finishes.
  if (lockEditor !== null) {
    hidePopover()
    selPending = null
    setStatus(`📝 ${lockEditor} is editing — commenting resumes when they finish`)
    return
  }
  const range = sel.getRangeAt(0)
  const offsets = selectionToOffsets(els.review, range, reviewMd)
  if (!offsets) {
    hidePopover()
    return
  }
  selPending = { ...offsets, quote: reviewMd.slice(offsets.start, offsets.end) }
  const rect = range.getBoundingClientRect()
  els.popover.style.display = 'flex'
  els.popover.style.left = `${Math.max(8, rect.left)}px`
  els.popover.style.top = `${Math.max(8, rect.top - els.popover.offsetHeight - 6)}px`
}

// ---------- sidebar (composer + comments) ----------
// Paste rich content (e.g. a formatted message from Claude) → convert clipboard HTML to Markdown so
// the comment keeps formatting, without a rich editor. Plain-text pastes fall through unchanged.
function richPaste(ta: HTMLTextAreaElement): void {
  ta.addEventListener('paste', (ev) => {
    const html = ev.clipboardData?.getData('text/html')
    if (!html) return
    ev.preventDefault()
    const md = htmlToMarkdown(html)
    const s = ta.selectionStart ?? ta.value.length
    const e = ta.selectionEnd ?? ta.value.length
    ta.value = ta.value.slice(0, s) + md + ta.value.slice(e)
    ta.selectionStart = ta.selectionEnd = s + md.length
  })
}

function replyComposerHtml(): Html {
  const warn = replyWarning
    ? html`<div class="warn">⚠ The message you are replying to changed to: "${replyWarning}". Review it, then press Send again.</div>`
    : ''
  return html`<div class="reply">${warn}<textarea id="rbody" rows="2" placeholder="Reply"></textarea><div class="actions"><button id="rsave">Send</button><button id="rcancel">Cancel</button></div></div>`
}

function editComposerHtml(body: string): Html {
  return html`<div class="editbox"><textarea id="ebody" rows="3">${body}</textarea><div class="actions"><button id="esave">Save</button><button id="ecancel">Cancel</button></div></div>`
}

/** Reply + (author-only, while childless) Edit buttons for a node. */
function nodeButtons(node: { id: string; author: string; replies: unknown[] }, owner: string): Html {
  const edit =
    node.author === user && node.replies.length === 0
      ? html`<button data-act="edit" data-pid="${node.id}" data-owner="${owner}">Edit</button>`
      : ''
  return html`<button data-act="reply" data-pid="${node.id}" data-owner="${owner}">Reply</button>${edit}`
}

function reactionsRow(node: { id: string; reactions?: Record<string, string[]> }, owner: string): Html {
  const chips = REACTIONS.map((e) => {
    const users = node.reactions?.[e] ?? []
    const mine = users.includes(user)
    return html`<button class="rx${mine ? ' mine' : ''}" data-act="react" data-emoji="${e}" data-pid="${node.id}" data-owner="${owner}" title="${users.join(', ')}">${e}${users.length ? ' ' + String(users.length) : ''}</button>`
  })
  return html`<div class="reactions">${chips}</div>`
}

function renderReplies(replies: Reply[], owner: string): Html {
  const items = replies.map((r) => {
    const bodyHtml = editing && editing.id === r.id ? editComposerHtml(r.body) : html`<span class="body">${raw(renderComment(r.body))}</span>`
    return html`<div class="reply"><div><b>${r.author}:</b> ${bodyHtml}</div>${reactionsRow(r, owner)}<div class="actions">${nodeButtons(r, owner)}</div>${replyTo && replyTo.id === r.id ? replyComposerHtml() : ''}${renderReplies(r.replies, owner)}</div>`
  })
  return html`${items}`
}

const RESOLUTION_COLOR: Record<string, string> = { intact: '#2da44e', moved: '#2f6feb', orphaned: '#cf222e' }

function renderSidebar(): void {
  const parts: Html[] = []
  if (composer) {
    const isSuggest = composer.mode === 'suggest'
    const proposal = isSuggest
      ? html`<div style="font-size:11px;color:#555;margin-top:4px">Proposed replacement:</div><textarea id="cprop" rows="2">${composer.quote}</textarea>`
      : ''
    parts.push(html`<div class="cmt"><span class="q">${composer.quote}</span>${proposal}<textarea id="cbody" rows="2" placeholder="${isSuggest ? 'Why (optional)' : 'Comment'}"></textarea><div class="actions"><button id="csave">${isSuggest ? 'Suggest' : 'Comment'}</button><button id="ccancel">Cancel</button></div></div>`)
  }
  if (lastComments.length === 0 && !composer) {
    parts.push(html`<p class="hint">Select text in the document to comment or suggest a change.</p>`)
  }
  for (const c of lastComments) {
    const resolved = c.comment.status === 'resolved'
    const meta = `${resolved ? 'resolved' : c.resolution.status} · ${c.owner}`
    const sug = c.comment.suggestion !== undefined
      ? html`<div class="sug"><span class="old">${c.comment.anchor.quote}</span> → <span class="new">${c.comment.suggestion}</span></div>`
      : ''
    const body = editing && editing.id === c.comment.id
      ? editComposerHtml(c.comment.body)
      : c.comment.body ? html`<div class="body">${raw(renderComment(c.comment.body))}</div>` : ''
    const approveReject = c.comment.suggestion !== undefined && role === 'editor' && !resolved
      ? html`<button data-act="approve">Approve</button><button data-act="reject">Reject</button>`
      : ''
    parts.push(html`<div class="cmt" data-id="${c.comment.id}" data-owner="${c.owner}"><span class="q">${c.comment.anchor.quote}</span><span class="meta" style="color:${resolved ? '#888' : RESOLUTION_COLOR[c.resolution.status] ?? '#888'}">${meta}</span>${sug}${body}${reactionsRow(c.comment, c.owner)}${renderReplies(c.comment.replies, c.owner)}${replyTo && replyTo.id === c.comment.id ? replyComposerHtml() : ''}<div class="actions">${nodeButtons(c.comment, c.owner)}${approveReject}</div></div>`)
  }
  els.cmtList.innerHTML = html`${parts}`.value
  wireSidebar()
}

function wireSidebar(): void {
  if (composer) {
    const bodyEl = $<HTMLTextAreaElement>('#cbody')
    const propEl = els.cmtList.querySelector<HTMLTextAreaElement>('#cprop')
    bodyEl.focus()
    richPaste(bodyEl)
    $<HTMLButtonElement>('#csave').addEventListener('click', () => run(() => saveComposer(bodyEl.value.trim(), propEl?.value ?? '')))
    $<HTMLButtonElement>('#ccancel').addEventListener('click', () => {
      composer = null
      renderSidebar()
    })
  }
  const rb = els.cmtList.querySelector<HTMLTextAreaElement>('#rbody')
  if (rb && replyTo) {
    rb.value = replyDraft
    rb.focus()
    richPaste(rb)
    els.cmtList.querySelector<HTMLButtonElement>('#rsave')!.addEventListener('click', () => run(() => sendReply(rb.value.trim())))
    els.cmtList.querySelector<HTMLButtonElement>('#rcancel')!.addEventListener('click', () => {
      replyTo = null
      replyWarning = null
      replyDraft = ''
      renderSidebar()
    })
  }
  const eb = els.cmtList.querySelector<HTMLTextAreaElement>('#ebody')
  if (eb && editing) {
    eb.focus()
    richPaste(eb)
    els.cmtList.querySelector<HTMLButtonElement>('#esave')!.addEventListener('click', () => run(() => saveEdit(eb.value)))
    els.cmtList.querySelector<HTMLButtonElement>('#ecancel')!.addEventListener('click', () => {
      editing = null
      renderSidebar()
    })
  }
  for (const card of els.cmtList.querySelectorAll<HTMLDivElement>('.cmt[data-id]')) {
    const sc = lastComments.find((c) => c.comment.id === card.dataset.id)
    card.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement
      if (t.closest('button') || t.closest('textarea')) return
      if (sc) focusComment(sc)
    })
  }
  for (const btn of els.cmtList.querySelectorAll<HTMLButtonElement>('button[data-act]')) {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      const act = btn.dataset.act
      if (act === 'reply') {
        editing = null
        const pid = btn.dataset.pid!
        replyTo = { id: pid, owner: btn.dataset.owner!, parentBody: findNodeBody(lastComments, pid) ?? '' }
        replyWarning = null
        replyDraft = ''
        renderSidebar()
      } else if (act === 'edit') {
        replyTo = null
        editing = { id: btn.dataset.pid!, owner: btn.dataset.owner! }
        renderSidebar()
      } else if (act === 'approve' || act === 'reject') {
        const card = btn.closest('.cmt[data-id]') as HTMLElement
        const cid = card.dataset.id!
        const owner = card.dataset.owner!
        const route = act === 'approve' ? 'suggestion/apply' : 'suggestion/reject'
        run(async () => {
          await api('POST', route, { query: { path: file }, body: { commentId: cid, owner } })
          await (act === 'approve' ? loadFile() : renderReview())
        })
      } else if (act === 'react') {
        const { pid, owner, emoji } = btn.dataset
        run(async () => {
          await api('POST', 'react', { query: { path: file }, body: { nodeId: pid, owner, emoji } })
          await renderReview()
        })
      }
    })
  }
}

async function saveEdit(body: string): Promise<void> {
  if (!editing) return
  const target = editing
  editing = null
  await api('POST', 'edit', { query: { path: file }, body: { nodeId: target.id, owner: target.owner, body: body.trim() } })
  await renderReview()
}

async function saveComposer(body: string, proposal: string): Promise<void> {
  if (!composer) return
  const payload: Record<string, unknown> = { start: composer.start, end: composer.end, body }
  if (composer.mode === 'suggest') payload.suggestion = proposal
  if (body || composer.mode === 'suggest') await api('POST', 'comment', { query: { path: file }, body: payload })
  composer = null
  await renderReview()
}

async function sendReply(body: string): Promise<void> {
  if (!replyTo) return
  if (!body) {
    replyTo = null
    replyWarning = null
    replyDraft = ''
    renderSidebar()
    return
  }
  // Concurrency: the message being replied to may have been edited since the composer opened (it had
  // no replies yet, so its author could still edit it). Re-check and, if it changed, warn instead of
  // silently posting against stale text — the user reviews the new version and sends again.
  const { comments } = await api<{ comments: Sidecar[] }>('GET', 'comments', { query: { path: file } })
  const freshBody = findNodeBody(comments, replyTo.id)
  if (freshBody !== null && freshBody !== replyTo.parentBody) {
    replyWarning = freshBody
    replyTo.parentBody = freshBody
    replyDraft = body
    lastComments = comments
    renderSidebar()
    return
  }
  await api('POST', 'reply', { query: { path: file }, body: { parentId: replyTo.id, owner: replyTo.owner, body } })
  replyTo = null
  replyWarning = null
  replyDraft = ''
  await renderReview()
}

// ---------- events ----------
els.review.addEventListener('mouseup', () => setTimeout(onReviewMouseUp, 0))
// Editor interaction (typing / cursor) → debounced auto-save + throttled lock heartbeat (D20).
els.edit.addEventListener('input', onEditorInteraction)
els.edit.addEventListener('keyup', onEditorInteraction)
els.popover.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) =>
  b.addEventListener('mousedown', (ev) => {
    ev.preventDefault() // keep the selection alive
    if (!selPending) return
    composer = { mode: b.dataset.act === 'suggest' ? 'suggest' : 'comment', ...selPending }
    hidePopover()
    renderSidebar()
  }),
)
els.user.addEventListener('change', () => {
  run(async () => {
    if (currentView === 'edit') await exitEditView(true) // don't strand a lock under the old identity
    // Reload with the new identity in the URL — a clean boot, no interleaving with the old session.
    window.location.search = `?user=${encodeURIComponent(els.user.value)}`
  })
})
els.file.addEventListener('change', () => {
  run(async () => {
    if (currentView === 'edit') await exitEditView(true) // release the lock on the old file before switching
    file = els.file.value
    await loadFile()
  })
})
els.search.addEventListener('input', () => runSearch(els.search.value))
els.search.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault()
    stepSearch(ev.shiftKey ? -1 : 1) // Enter = next match, Shift+Enter = previous
  }
})
els.zoomIn.addEventListener('click', () => setZoom(1))
els.zoomOut.addEventListener('click', () => setZoom(-1))
els.btnEdit.addEventListener('click', () => run(enterEdit))
els.btnReview.addEventListener('click', () =>
  run(async () => {
    if (currentView === 'edit') await exitEditView(true) // leaving the editor publishes + frees the lock
    else await renderReview()
  }),
)
els.btnMerge.addEventListener('click', () => run(() => exitEditView(true)))

run(boot)
