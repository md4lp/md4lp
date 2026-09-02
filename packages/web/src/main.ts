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
  btnOpenAuth: $<HTMLButtonElement>('#btnOpenAuth'),
  userProfileBadge: $<HTMLDivElement>('#userProfileBadge'),
  userBadgeAvatar: $<HTMLImageElement>('#userBadgeAvatar'),
  userBadgeName: $<HTMLSpanElement>('#userBadgeName'),
  btnManageAccount: $<HTMLButtonElement>('#btnManageAccount'),
  btnLogout: $<HTMLButtonElement>('#btnLogout'),
  authModal: $<HTMLDialogElement>('#authModal'),
  authModalTitle: $<HTMLHeadingElement>('#authModalTitle'),
  authErrorBanner: $<HTMLDivElement>('#authErrorBanner'),
  authStepEmail: $<HTMLDivElement>('#authStepEmail'),
  authStepRegister: $<HTMLDivElement>('#authStepRegister'),
  authStepCode: $<HTMLDivElement>('#authStepCode'),
  regEmailInput: $<HTMLInputElement>('#regEmailInput'),
  regUsernameInput: $<HTMLInputElement>('#regUsernameInput'),
  regUsernameFeedback: $<HTMLDivElement>('#regUsernameFeedback'),
  regNameInput: $<HTMLInputElement>('#regNameInput'),
  btnBackToIdentifier: $<HTMLButtonElement>('#btnBackToIdentifier'),
  btnRegisterSendCode: $<HTMLButtonElement>('#btnRegisterSendCode'),
  authEmailInput: $<HTMLInputElement>('#authEmailInput'),
  authCodeInput: $<HTMLInputElement>('#authCodeInput'),
  authTargetEmail: $<HTMLElement>('#authTargetEmail'),
  authDevHelper: $<HTMLDivElement>('#authDevHelper'),
  btnSendCode: $<HTMLButtonElement>('#btnSendCode'),
  btnVerifyCode: $<HTMLButtonElement>('#btnVerifyCode'),
  btnCancelAuth: $<HTMLButtonElement>('#btnCancelAuth'),
  btnBackToEmail: $<HTMLButtonElement>('#btnBackToEmail'),
  accountModal: $<HTMLDialogElement>('#accountModal'),
  accErrorBanner: $<HTMLDivElement>('#accErrorBanner'),
  accAvatarLarge: $<HTMLDivElement>('#accAvatarLarge'),
  accUserName: $<HTMLElement>('#accUserName'),
  accUserHandle: $<HTMLElement>('#accUserHandle'),
  accEditName: $<HTMLInputElement>('#accEditName'),
  accEditUsername: $<HTMLInputElement>('#accEditUsername'),
  accEditAvatar: $<HTMLInputElement>('#accEditAvatar'),
  btnSaveProfile: $<HTMLButtonElement>('#btnSaveProfile'),
  accEmailList: $<HTMLDivElement>('#accEmailList'),
  addEmailInput: $<HTMLInputElement>('#addEmailInput'),
  btnSendAddCode: $<HTMLButtonElement>('#btnSendAddCode'),
  btnCloseAccountModal: $<HTMLButtonElement>('#btnCloseAccountModal'),

  btnNotifications: $<HTMLButtonElement>('#btnNotifications'),
  notifBadge: $<HTMLElement>('#notifBadge'),
  notificationsModal: $<HTMLDialogElement>('#notificationsModal'),
  btnCloseNotificationsModal: $<HTMLButtonElement>('#btnCloseNotificationsModal'),
  notifEmptyMsg: $<HTMLDivElement>('#notifEmptyMsg'),
  notifTeamInvsSection: $<HTMLDivElement>('#notifTeamInvsSection'),
  notifTeamInvsCount: $<HTMLElement>('#notifTeamInvsCount'),
  notifTeamInvsList: $<HTMLDivElement>('#notifTeamInvsList'),
  notifProjectInvsSection: $<HTMLDivElement>('#notifProjectInvsSection'),
  notifProjectInvsCount: $<HTMLElement>('#notifProjectInvsCount'),
  notifProjectInvsList: $<HTMLDivElement>('#notifProjectInvsList'),

  btnTeams: $<HTMLButtonElement>('#btnTeams'),
  teamsModal: $<HTMLDialogElement>('#teamsModal'),
  teamsErrorBanner: $<HTMLDivElement>('#teamsErrorBanner'),
  pendingInvsSection: $<HTMLDivElement>('#pendingInvsSection'),
  pendingInvsList: $<HTMLDivElement>('#pendingInvsList'),
  joinedTeamsList: $<HTMLDivElement>('#joinedTeamsList'),
  availDomainTeamsSection: $<HTMLDivElement>('#availDomainTeamsSection'),
  availDomainTeamsList: $<HTMLDivElement>('#availDomainTeamsList'),
  newTeamNameInput: $<HTMLInputElement>('#newTeamNameInput'),
  btnCreateTeam: $<HTMLButtonElement>('#btnCreateTeam'),
  btnCloseTeamsModal: $<HTMLButtonElement>('#btnCloseTeamsModal'),
  teamDetailsModal: $<HTMLDialogElement>('#teamDetailsModal'),
  teamDetailName: $<HTMLElement>('#teamDetailName'),
  teamDetailTypeBadge: $<HTMLElement>('#teamDetailTypeBadge'),
  teamDetailErrorBanner: $<HTMLDivElement>('#teamDetailErrorBanner'),
  teamDetailMemberCount: $<HTMLElement>('#teamDetailMemberCount'),
  teamDetailMemberList: $<HTMLDivElement>('#teamDetailMemberList'),
  teamDetailPendingInvsSection: $<HTMLDivElement>('#teamDetailPendingInvsSection'),
  teamDetailPendingInvsCount: $<HTMLElement>('#teamDetailPendingInvsCount'),
  teamDetailPendingInvsList: $<HTMLDivElement>('#teamDetailPendingInvsList'),
  teamInviteSection: $<HTMLDivElement>('#teamInviteSection'),
  teamInviteTargetInput: $<HTMLInputElement>('#teamInviteTargetInput'),
  teamInviteRoleSelect: $<HTMLSelectElement>('#teamInviteRoleSelect'),
  btnSendTeamInvite: $<HTMLButtonElement>('#btnSendTeamInvite'),
  memberExpelPrompt: $<HTMLDivElement>('#memberExpelPrompt'),
  memberExpelTargetEmail: $<HTMLElement>('#memberExpelTargetEmail'),
  memberExpelDevHelper: $<HTMLDivElement>('#memberExpelDevHelper'),
  memberExpelCodeInput: $<HTMLInputElement>('#memberExpelCodeInput'),
  btnConfirmMemberExpel: $<HTMLButtonElement>('#btnConfirmMemberExpel'),
  btnCancelMemberExpel: $<HTMLButtonElement>('#btnCancelMemberExpel'),
  btnLeaveTeam: $<HTMLButtonElement>('#btnLeaveTeam'),
  btnCloseTeamDetailsModal: $<HTMLButtonElement>('#btnCloseTeamDetailsModal'),

  btnProjects: $<HTMLButtonElement>('#btnProjects'),
  projectsModal: $<HTMLDialogElement>('#projectsModal'),
  projectsErrorBanner: $<HTMLDivElement>('#projectsErrorBanner'),
  pendingProjInvsSection: $<HTMLDivElement>('#pendingProjInvsSection'),
  pendingProjInvsList: $<HTMLDivElement>('#pendingProjInvsList'),
  joinedProjectsList: $<HTMLDivElement>('#joinedProjectsList'),
  newProjectNameInput: $<HTMLInputElement>('#newProjectNameInput'),
  newProjectSlugInput: $<HTMLInputElement>('#newProjectSlugInput'),
  newProjectDescInput: $<HTMLInputElement>('#newProjectDescInput'),
  newProjectContextEmailSelect: $<HTMLSelectElement>('#newProjectContextEmailSelect'),
  btnCreateProject: $<HTMLButtonElement>('#btnCreateProject'),
  btnCloseProjectsModal: $<HTMLButtonElement>('#btnCloseProjectsModal'),
  projectDetailsModal: $<HTMLDialogElement>('#projectDetailsModal'),
  projectDetailName: $<HTMLElement>('#projectDetailName'),
  projectDetailRoleBadge: $<HTMLElement>('#projectDetailRoleBadge'),
  projectDetailSlug: $<HTMLElement>('#projectDetailSlug'),
  projectDetailErrorBanner: $<HTMLDivElement>('#projectDetailErrorBanner'),
  projectContextEmailSection: $<HTMLDivElement>('#projectContextEmailSection'),
  projectMyContextEmailSelect: $<HTMLSelectElement>('#projectMyContextEmailSelect'),
  btnUpdateProjectContextEmail: $<HTMLButtonElement>('#btnUpdateProjectContextEmail'),
  projectDetailMemberCount: $<HTMLElement>('#projectDetailMemberCount'),
  projectDetailMemberList: $<HTMLDivElement>('#projectDetailMemberList'),
  projectDetailPendingInvsSection: $<HTMLDivElement>('#projectDetailPendingInvsSection'),
  projectDetailPendingInvsCount: $<HTMLElement>('#projectDetailPendingInvsCount'),
  projectDetailPendingInvsList: $<HTMLDivElement>('#projectDetailPendingInvsList'),
  projectDetailTeamCount: $<HTMLElement>('#projectDetailTeamCount'),
  projectDetailTeamList: $<HTMLDivElement>('#projectDetailTeamList'),
  projectOwnerSection: $<HTMLDivElement>('#projectOwnerSection'),
  projectAssignTeamSelect: $<HTMLSelectElement>('#projectAssignTeamSelect'),
  projectAssignTeamRoleSelect: $<HTMLSelectElement>('#projectAssignTeamRoleSelect'),
  btnAssignProjectTeam: $<HTMLButtonElement>('#btnAssignProjectTeam'),
  projectInviteTargetInput: $<HTMLInputElement>('#projectInviteTargetInput'),
  projectInviteRoleSelect: $<HTMLSelectElement>('#projectInviteRoleSelect'),
  btnSendProjectInvite: $<HTMLButtonElement>('#btnSendProjectInvite'),
  projectMemberRemovePrompt: $<HTMLDivElement>('#projectMemberRemovePrompt'),
  projMemberRemoveTargetEmail: $<HTMLElement>('#projMemberRemoveTargetEmail'),
  projMemberRemoveDevHelper: $<HTMLDivElement>('#projMemberRemoveDevHelper'),
  projMemberRemoveCodeInput: $<HTMLInputElement>('#projMemberRemoveCodeInput'),
  btnConfirmProjMemberRemove: $<HTMLButtonElement>('#btnConfirmProjMemberRemove'),
  btnCancelProjMemberRemove: $<HTMLButtonElement>('#btnCancelProjMemberRemove'),
  btnLeaveProject: $<HTMLButtonElement>('#btnLeaveProject'),
  btnCloseProjectDetailsModal: $<HTMLButtonElement>('#btnCloseProjectDetailsModal'),

  connectedAgentsList: $<HTMLDivElement>('#connectedAgentsList'),
  authorizeAgentModal: $<HTMLDialogElement>('#authorizeAgentModal'),
  authAgentErrorBanner: $<HTMLDivElement>('#authAgentErrorBanner'),
  authAgentClientName: $<HTMLElement>('#authAgentClientName'),
  authAgentProjectMatrix: $<HTMLDivElement>('#authAgentProjectMatrix'),
  authAgentSuccessBox: $<HTMLDivElement>('#authAgentSuccessBox'),
  authAgentBtnRow: $<HTMLDivElement>('#authAgentBtnRow'),
  btnSubmitAuthorizeAgent: $<HTMLButtonElement>('#btnSubmitAuthorizeAgent'),
  btnCancelAuthorizeAgent: $<HTMLButtonElement>('#btnCancelAuthorizeAgent'),
  btnCloseAuthorizeAgentSuccess: $<HTMLButtonElement>('#btnCloseAuthorizeAgentSuccess'),
}

interface UserEmail {
  email: string
  userId: string
  verifiedAt: number | null
  isPrimary: boolean
  createdAt: number
}

interface UserProfile {
  id: string
  username: string
  name: string
  avatarUrl?: string
  defaultEmail: string
  emails: UserEmail[]
}

interface ProjectMemberWithUser {
  projectId: string
  userId: string
  role: 'owner' | 'editor' | 'commenter' | 'viewer'
  contextEmail: string
  joinedAt: number
  username: string
  name: string
  avatarUrl?: string
}

interface ProjectTeamWithDetails {
  projectId: string
  teamId: string
  role: 'owner' | 'editor' | 'commenter' | 'viewer'
  assignedAt: number
  teamName: string
  teamType: 'private' | 'domain'
  memberCount: number
}

interface ProjectWithDetails {
  id: string
  name: string
  slug: string
  description?: string
  repoPath: string
  ownerUserId: string
  createdAt: number
  updatedAt: number
  members: ProjectMemberWithUser[]
  teams: ProjectTeamWithDetails[]
  effectiveRole?: 'owner' | 'editor' | 'commenter' | 'viewer'
  currentContextEmail?: string
  pendingInvitations?: ProjectInvitation[]
}

interface ProjectInvitation {
  id: string
  projectId: string
  projectName?: string
  invitedBy: string
  inviterName?: string
  role: 'owner' | 'editor' | 'commenter' | 'viewer'
  targetUsername?: string
  targetEmail?: string
  status: string
  createdAt: number
  expiresAt: number
}

let currentUser: UserProfile | null = null
let currentEmail = ''

function escapeHtml(str: string): string {
  return str.replace(/[&<>'"]/g, (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[tag] || tag))
}

async function api<T = unknown>(method: string, path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const q = new URLSearchParams({ user, ...(opts.query ?? {}) })
  const token = localStorage.getItem('md4lp_token')
  const headers: Record<string, string> = {}
  if (opts.body) headers['content-type'] = 'application/json'
  if (token) headers['authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`/api/${path}?${q.toString()}`, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
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

// ---------- auth & multi-email UI ----------
async function refreshAuthUI(): Promise<void> {
  const token = localStorage.getItem('md4lp_token')
  if (!token) {
    currentUser = null
    els.btnOpenAuth.style.display = 'inline-block'
    els.userProfileBadge.style.display = 'none'
    return
  }

  try {
    const res = await api<{ ok: boolean; user: UserProfile; currentEmail: string }>('GET', 'auth/me')
    if (res.ok && res.user) {
      currentUser = res.user
      currentEmail = res.currentEmail
      els.btnOpenAuth.style.display = 'none'
      els.userProfileBadge.style.display = 'flex'
      els.userBadgeName.textContent = `${res.user.name} (@${res.user.username})`
      if (res.user.avatarUrl) {
        els.userBadgeAvatar.src = res.user.avatarUrl
        els.userBadgeAvatar.style.display = 'inline-block'
      } else {
        els.userBadgeAvatar.style.display = 'none'
      }
      await updateNotificationsBadge()
      await handleUrlHashActions()
    } else {
      localStorage.removeItem('md4lp_token')
      els.btnOpenAuth.style.display = 'inline-block'
      els.userProfileBadge.style.display = 'none'
    }
  } catch {
    localStorage.removeItem('md4lp_token')
    els.btnOpenAuth.style.display = 'inline-block'
    els.userProfileBadge.style.display = 'none'
  }
}

function renderAccountEmails(): void {
  if (!currentUser) return
  els.accUserName.textContent = currentUser.name
  els.accUserHandle.textContent = `@${currentUser.username} • Primary: ${currentUser.defaultEmail}`
  els.accEditName.value = currentUser.name
  els.accEditUsername.value = currentUser.username
  els.accEditAvatar.value = currentUser.avatarUrl || ''

  if (currentUser.avatarUrl) {
    els.accAvatarLarge.innerHTML = `<img src="${currentUser.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="${currentUser.name}" />`
  } else {
    els.accAvatarLarge.textContent = currentUser.name.charAt(0).toUpperCase() || 'U'
  }

  els.accEmailList.innerHTML = currentUser.emails.map((e) => {
    const safeId = btoa(e.email).replace(/=/g, '')
    if (e.verifiedAt) {
      return `
        <div class="email-item">
          <div class="email-header-row">
            <div>
              <b>${e.email}</b>
              ${e.isPrimary ? '<span class="badge-primary">Primary</span>' : ''}
              <span style="color: #2da44e; font-size: 11px; margin-left: 4px;">✓ Verified</span>
            </div>
            <div style="display: flex; gap: 4px;">
              ${!e.isPrimary ? `<button class="btnMakePrimary" data-email="${e.email}">Make Primary</button>` : ''}
              ${!e.isPrimary && currentUser!.emails.length > 1 ? `<button class="btnRemoveEmail" data-email="${e.email}" style="color: #cf222e;">Remove</button>` : ''}
            </div>
          </div>
        </div>
      `
    } else {
      return `
        <div class="email-item" style="background: var(--surface); padding: 8px; border-radius: 6px; margin-bottom: 6px;">
          <div class="email-header-row">
            <div>
              <b>${e.email}</b>
              <span class="badge-pending" style="margin-left: 4px;">⏳ Pending Verification</span>
            </div>
            <div style="display: flex; gap: 4px;">
              <button class="btnToggleVerify" data-target="verifyBox_${safeId}">Verify Code</button>
              <button class="btnResendCode" data-email="${e.email}">Resend</button>
              <button class="btnRemoveEmail" data-email="${e.email}" style="color: #cf222e;">Delete</button>
            </div>
          </div>
          <div id="verifyBox_${safeId}" class="verify-inline-box" style="display: none; margin-top: 8px;">
            <div class="dev-helper dev-helper-inline" id="devHelper_${safeId}" style="display: none;"></div>
            <div style="display: flex; gap: 6px; align-items: center;">
              <input type="text" class="inputPendingCode" id="input_${safeId}" maxlength="6" placeholder="Enter 6-digit code" style="width: 150px; margin: 0; padding: 4px 8px;" />
              <button class="primary btnSubmitPendingVerify" data-email="${e.email}" data-input="input_${safeId}">Confirm</button>
            </div>
          </div>
        </div>
      `
    }
  }).join('')

  els.accEmailList.querySelectorAll<HTMLButtonElement>('.btnMakePrimary').forEach((btn) => {
    btn.onclick = () => run(async () => {
      const targetEmail = btn.dataset.email!
      await api('POST', 'auth/emails/primary', { body: { email: targetEmail } })
      await refreshAuthUI()
      renderAccountEmails()
      setStatus(`Primary email set to ${targetEmail}`)
    })
  })

  els.accEmailList.querySelectorAll<HTMLButtonElement>('.btnRemoveEmail').forEach((btn) => {
    btn.onclick = () => run(async () => {
      const targetEmail = btn.dataset.email!
      await api('DELETE', 'auth/emails', { body: { email: targetEmail } })
      await refreshAuthUI()
      renderAccountEmails()
      setStatus(`Removed email ${targetEmail}`)
    })
  })

  els.accEmailList.querySelectorAll<HTMLButtonElement>('.btnToggleVerify').forEach((btn) => {
    btn.onclick = () => {
      const box = document.getElementById(btn.dataset.target!)
      if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none'
    }
  })

  els.accEmailList.querySelectorAll<HTMLButtonElement>('.btnResendCode').forEach((btn) => {
    btn.onclick = () => run(async () => {
      const targetEmail = btn.dataset.email!
      const res = await api<{ ok: boolean; devCode?: string }>('POST', 'auth/emails/request-add', {
        body: { email: targetEmail },
      })
      const safeId = btoa(targetEmail).replace(/=/g, '')
      const box = document.getElementById(`verifyBox_${safeId}`)
      const helper = document.getElementById(`devHelper_${safeId}`)
      const input = document.getElementById(`input_${safeId}`) as HTMLInputElement
      if (box) box.style.display = 'block'
      if (helper && res.devCode) {
        helper.textContent = `[Dev code]: ${res.devCode}`
        helper.style.display = 'block'
      }
      if (input && res.devCode) input.value = res.devCode
      setStatus(`Verification code sent to ${targetEmail}`)
    })
  })

  els.accEmailList.querySelectorAll<HTMLButtonElement>('.btnSubmitPendingVerify').forEach((btn) => {
    btn.onclick = () => run(async () => {
      const targetEmail = btn.dataset.email!
      const inputEl = document.getElementById(btn.dataset.input!) as HTMLInputElement
      const code = inputEl?.value.trim()
      if (!code) {
        alert('Please enter the verification code')
        return
      }
      await api('POST', 'auth/emails/verify-add', { body: { email: targetEmail, code } })
      await refreshAuthUI()
      renderAccountEmails()
      setStatus(`✓ Successfully verified ${targetEmail}`)
    })
  })
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

let pendingAuthIdentifier = ''
let pendingAuthUsername: string | undefined
let pendingAuthName: string | undefined

// Auth Modal Listeners
els.btnOpenAuth.addEventListener('click', () => {
  els.authErrorBanner.style.display = 'none'
  els.authErrorBanner.textContent = ''
  els.authStepEmail.style.display = 'block'
  els.authStepRegister.style.display = 'none'
  els.authStepCode.style.display = 'none'
  els.authEmailInput.value = ''
  els.regEmailInput.value = ''
  els.regUsernameInput.value = ''
  els.regNameInput.value = ''
  els.authCodeInput.value = ''
  els.authDevHelper.style.display = 'none'
  pendingAuthIdentifier = ''
  pendingAuthUsername = undefined
  pendingAuthName = undefined
  els.authModal.showModal()
})

els.btnCancelAuth.addEventListener('click', () => els.authModal.close())

els.btnBackToIdentifier.addEventListener('click', () => {
  els.authErrorBanner.style.display = 'none'
  els.authErrorBanner.textContent = ''
  els.authStepEmail.style.display = 'block'
  els.authStepRegister.style.display = 'none'
  els.authStepCode.style.display = 'none'
})

els.btnBackToEmail.addEventListener('click', () => {
  els.authErrorBanner.style.display = 'none'
  els.authErrorBanner.textContent = ''
  if (pendingAuthUsername) {
    els.authStepEmail.style.display = 'none'
    els.authStepRegister.style.display = 'block'
    els.authStepCode.style.display = 'none'
  } else {
    els.authStepEmail.style.display = 'block'
    els.authStepRegister.style.display = 'none'
    els.authStepCode.style.display = 'none'
  }
})

els.btnSendCode.addEventListener('click', () => run(async () => {
  els.authErrorBanner.style.display = 'none'
  els.authErrorBanner.textContent = ''
  const identifier = els.authEmailInput.value.trim()
  if (!identifier) {
    els.authErrorBanner.textContent = 'Please enter an email address or username'
    els.authErrorBanner.style.display = 'block'
    return
  }

  try {
    const lookup = await api<{
      exists: boolean
      isEmail: boolean
      cleanIdentifier: string
      targetEmail?: string
      username?: string
      name?: string
    }>('POST', 'auth/lookup', {
      body: { identifier },
    })

    if (lookup.exists) {
      // Existing user: send login OTP
      pendingAuthIdentifier = identifier
      pendingAuthUsername = undefined
      pendingAuthName = undefined

      const res = await api<{ ok: boolean; email: string; devCode?: string }>('POST', 'auth/request-code', {
        body: { identifier, purpose: 'login' },
      })
      els.authTargetEmail.textContent = res.email
      els.authStepEmail.style.display = 'none'
      els.authStepRegister.style.display = 'none'
      els.authStepCode.style.display = 'block'
      if (res.devCode) {
        els.authDevHelper.textContent = `[Dev mode] Your single-use code is: ${res.devCode}`
        els.authDevHelper.style.display = 'block'
        els.authCodeInput.value = res.devCode
      }
    } else {
      // New user: go to registration step to select username & display name
      els.authStepEmail.style.display = 'none'
      els.authStepRegister.style.display = 'block'
      els.authStepCode.style.display = 'none'

      if (lookup.isEmail) {
        els.regEmailInput.value = lookup.cleanIdentifier
        els.regEmailInput.disabled = true
        els.regUsernameInput.value = ''
        els.regNameInput.value = ''
        els.regUsernameInput.focus()
      } else {
        els.regUsernameInput.value = lookup.cleanIdentifier
        els.regUsernameInput.disabled = false
        els.regEmailInput.value = ''
        els.regEmailInput.disabled = false
        els.regNameInput.value = ''
        els.regEmailInput.focus()
      }
    }
  } catch (err) {
    els.authErrorBanner.textContent = err instanceof Error ? err.message : String(err)
    els.authErrorBanner.style.display = 'block'
  }
}))

els.btnRegisterSendCode.addEventListener('click', () => run(async () => {
  els.authErrorBanner.style.display = 'none'
  els.authErrorBanner.textContent = ''

  const email = els.regEmailInput.value.trim()
  const username = els.regUsernameInput.value.trim().replace(/^@+/, '')
  const name = els.regNameInput.value.trim() || undefined

  if (!email || !email.includes('@')) {
    els.authErrorBanner.textContent = 'Please enter a valid email address'
    els.authErrorBanner.style.display = 'block'
    return
  }
  if (!username || username.length < 2) {
    els.authErrorBanner.textContent = 'Username must be at least 2 characters long'
    els.authErrorBanner.style.display = 'block'
    return
  }

  try {
    // 1. Verify username availability
    const check = await api<{ available: boolean; normalized: string; error?: string }>('POST', 'auth/check-username', {
      body: { username },
    })
    if (!check.available) {
      els.authErrorBanner.textContent = check.error || `Username "@${username}" is already taken. Please choose another.`
      els.authErrorBanner.style.display = 'block'
      return
    }

    // 2. Request registration OTP code
    pendingAuthIdentifier = email
    pendingAuthUsername = username
    pendingAuthName = name

    const res = await api<{ ok: boolean; email: string; devCode?: string }>('POST', 'auth/request-code', {
      body: { identifier: email, username, name, purpose: 'login' },
    })

    els.authTargetEmail.textContent = res.email
    els.authStepRegister.style.display = 'none'
    els.authStepCode.style.display = 'block'
    if (res.devCode) {
      els.authDevHelper.textContent = `[Dev mode] Your single-use code is: ${res.devCode}`
      els.authDevHelper.style.display = 'block'
      els.authCodeInput.value = res.devCode
    }
  } catch (err) {
    els.authErrorBanner.textContent = err instanceof Error ? err.message : String(err)
    els.authErrorBanner.style.display = 'block'
  }
}))

els.btnVerifyCode.addEventListener('click', () => run(async () => {
  els.authErrorBanner.style.display = 'none'
  els.authErrorBanner.textContent = ''
  const code = els.authCodeInput.value.trim()
  if (!code) {
    els.authErrorBanner.textContent = 'Please enter the 6-digit verification code'
    els.authErrorBanner.style.display = 'block'
    return
  }
  try {
    const res = await api<{ ok: true; token: string; user: UserProfile }>('POST', 'auth/verify-code', {
      body: {
        identifier: pendingAuthIdentifier,
        purpose: 'login',
        code,
        username: pendingAuthUsername,
        name: pendingAuthName,
      },
    })
    if (res.token) {
      localStorage.setItem('md4lp_token', res.token)
      els.authModal.close()
      await refreshAuthUI()
      setStatus(`✓ Signed in as ${res.user.name} (@${res.user.username})`)
    }
  } catch (err) {
    els.authErrorBanner.textContent = err instanceof Error ? err.message : String(err)
    els.authErrorBanner.style.display = 'block'
  }
}))

async function renderConnectedAgents(): Promise<void> {
  if (!currentUser) return
  els.connectedAgentsList.innerHTML = '<div style="color: var(--muted); padding: 4px 0;">Loading sessions...</div>'
  try {
    const res = await api<{
      ok: true
      sessions: Array<{
        id: string
        agentName: string
        tokenPrefix: string
        projectScopes: Array<{ projectId: string; maxRole: string }>
        status: string
        createdAt: number
        lastUsedAt: number
        absoluteExpiresAt: number
      }>
    }>('GET', 'auth/agent-sessions')
    const sessions = res.sessions || []
    if (sessions.length === 0) {
      els.connectedAgentsList.innerHTML = '<div style="color: var(--muted); padding: 4px 0;">No connected AI agents or MCP sessions.</div>'
      return
    }

    const projectsRes = await api<{ ok: true; projects: Array<{ id: string; name: string }> }>('GET', 'projects').catch(() => ({ ok: true as const, projects: [] }))
    const projMap = new Map((projectsRes.projects || []).map((p) => [p.id, p.name]))

    els.connectedAgentsList.innerHTML = sessions.map((s) => {
      const isExpired = s.status !== 'active'
      const statusBadge = isExpired
        ? '<span style="font-size: 10px; background: #fee2e2; color: #991b1b; padding: 1px 6px; border-radius: 4px;">Revoked / Expired</span>'
        : '<span style="font-size: 10px; background: #dcfce7; color: #166534; padding: 1px 6px; border-radius: 4px;">Active</span>'

      const scopeDesc = s.projectScopes && s.projectScopes.length > 0
        ? s.projectScopes.map((ps) => `<b>${projMap.get(ps.projectId) || ps.projectId}</b> (${ps.maxRole})`).join(', ')
        : 'None'

      const expDate = new Date(s.absoluteExpiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      const lastActive = new Date(s.lastUsedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

      return `
        <div style="padding: 8px 10px; margin-bottom: 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <b>🤖 ${s.agentName}</b>
              ${statusBadge}
              <code style="font-size: 10px; color: var(--muted);">${s.tokenPrefix}</code>
            </div>
            <div style="font-size: 11px; color: var(--muted); margin-top: 2px;">Projects: ${scopeDesc}</div>
            <div style="font-size: 10px; color: var(--muted); margin-top: 1px;">Last active: ${lastActive} • Expires: ${expDate}</div>
          </div>
          ${
            !isExpired
              ? `<button class="btn-revoke-agent" data-session-id="${s.id}" style="font-size: 11px; padding: 3px 8px; color: #ef4444; border-color: #fca5a5;">Revoke</button>`
              : ''
          }
        </div>
      `
    }).join('')

    els.connectedAgentsList.querySelectorAll<HTMLButtonElement>('.btn-revoke-agent').forEach((btn) => {
      btn.addEventListener('click', () => run(async () => {
        const sessionId = btn.getAttribute('data-session-id')
        if (!sessionId) return
        if (!confirm('Are you sure you want to revoke this agent session?')) return
        await api('DELETE', `auth/agent-sessions/${sessionId}`)
        await renderConnectedAgents()
        setStatus('✓ Agent session revoked')
      }))
    })
  } catch (err) {
    els.connectedAgentsList.innerHTML = `<div style="color: #ef4444; font-size: 11px;">Error loading agent sessions: ${err instanceof Error ? err.message : String(err)}</div>`
  }
}

els.btnManageAccount.addEventListener('click', () => {
  renderAccountEmails()
  renderConnectedAgents()
  els.addEmailInput.value = ''
  els.accountModal.showModal()
})

els.btnCloseAccountModal.addEventListener('click', () => els.accountModal.close())

els.btnSaveProfile.addEventListener('click', () => run(async () => {
  const name = els.accEditName.value.trim() || undefined
  const username = els.accEditUsername.value.trim() || undefined
  const avatarUrl = els.accEditAvatar.value.trim() || undefined
  const res = await api<{ ok: true; user: UserProfile }>('PATCH', 'auth/profile', {
    body: { name, username, avatarUrl },
  })
  if (res.ok) {
    currentUser = res.user
    await refreshAuthUI()
    renderAccountEmails()
    setStatus('✓ Profile updated successfully')
  }
}))

els.btnSendAddCode.addEventListener('click', () => run(async () => {
  const newEmail = els.addEmailInput.value.trim()
  if (!newEmail || !newEmail.includes('@')) {
    alert('Please enter a valid email address')
    return
  }
  const res = await api<{ ok: boolean; devCode?: string }>('POST', 'auth/emails/request-add', {
    body: { email: newEmail },
  })
  await refreshAuthUI()
  renderAccountEmails()
  els.addEmailInput.value = ''
  const safeId = btoa(newEmail).replace(/=/g, '')
  const box = document.getElementById(`verifyBox_${safeId}`)
  const helper = document.getElementById(`devHelper_${safeId}`)
  const input = document.getElementById(`input_${safeId}`) as HTMLInputElement
  if (box) box.style.display = 'block'
  if (helper && res.devCode) {
    helper.textContent = `[Dev code]: ${res.devCode}`
    helper.style.display = 'block'
  }
  if (input && res.devCode) input.value = res.devCode
  setStatus(`Added ${newEmail} (pending verification). Verification code sent.`)
}))

els.btnLogout.addEventListener('click', () => run(async () => {
  await api('POST', 'auth/logout')
  localStorage.removeItem('md4lp_token')
  await refreshAuthUI()
  setStatus('Signed out')
}))

// ---------- Teams & Organizations UI Logic ----------
interface Team {
  id: string
  name: string
  type: 'private' | 'domain'
  domain?: string
  createdBy: string
  createdAt: number
}

interface TeamMember {
  teamId: string
  userId: string
  role: 'admin' | 'member'
  contextEmail?: string
  joinedAt: number
  username: string
  name: string
  avatarUrl?: string
}

interface TeamWithDetails extends Team {
  members: TeamMember[]
  memberCount: number
  currentUserRole?: 'admin' | 'member'
  pendingInvitations?: TeamInvitation[]
}

interface TeamInvitation {
  id: string
  teamId: string
  invitedBy: string
  targetEmail?: string
  targetUsername?: string
  role: 'admin' | 'member'
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'revoked'
  expiresAt: number
  teamName: string
  inviterName: string
}

let currentActiveTeamId: string | null = null
let expelTargetUserId: string | null = null

async function updateNotificationsBadge(): Promise<void> {
  if (!currentUser) {
    els.notifBadge.style.display = 'none'
    return
  }
  try {
    const [teamInvsRes, projInvsRes] = await Promise.all([
      api<{ ok: boolean; invitations: TeamInvitation[] }>('GET', 'teams/invitations/pending'),
      api<{ ok: boolean; invitations: Array<ProjectInvitation & { projectName: string; inviterName: string }> }>('GET', 'projects/invitations/pending'),
    ])
    const teamCount = teamInvsRes.invitations?.length || 0
    const projCount = projInvsRes.invitations?.length || 0
    const total = teamCount + projCount

    if (total > 0) {
      els.notifBadge.textContent = String(total)
      els.notifBadge.style.display = 'inline-block'
    } else {
      els.notifBadge.style.display = 'none'
    }
  } catch {
    els.notifBadge.style.display = 'none'
  }
}

async function renderNotificationsModal(): Promise<void> {
  if (!currentUser) return
  try {
    const [teamInvsRes, projInvsRes] = await Promise.all([
      api<{ ok: boolean; invitations: TeamInvitation[] }>('GET', 'teams/invitations/pending'),
      api<{ ok: boolean; invitations: Array<ProjectInvitation & { projectName: string; inviterName: string }> }>('GET', 'projects/invitations/pending'),
    ])

    const teamInvs = teamInvsRes.invitations || []
    const projInvs = projInvsRes.invitations || []
    const total = teamInvs.length + projInvs.length

    if (total === 0) {
      els.notifEmptyMsg.style.display = 'block'
      els.notifTeamInvsSection.style.display = 'none'
      els.notifProjectInvsSection.style.display = 'none'
    } else {
      els.notifEmptyMsg.style.display = 'none'

      if (teamInvs.length > 0) {
        els.notifTeamInvsSection.style.display = 'block'
        els.notifTeamInvsCount.textContent = String(teamInvs.length)
        els.notifTeamInvsList.innerHTML = teamInvs
          .map((inv) => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; margin-bottom: 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px;">
              <div>
                <b>${escapeHtml(inv.teamName || 'Team')}</b> (invited by ${escapeHtml(inv.inviterName || 'User')} as <i>${inv.role}</i>)
              </div>
              <button onclick="window.handleNotifTeam()" class="primary" style="font-size: 11px; padding: 4px 8px;">Review / Go to Teams</button>
            </div>
          `)
          .join('')
      } else {
        els.notifTeamInvsSection.style.display = 'none'
        els.notifTeamInvsList.innerHTML = ''
      }

      if (projInvs.length > 0) {
        els.notifProjectInvsSection.style.display = 'block'
        els.notifProjectInvsCount.textContent = String(projInvs.length)
        els.notifProjectInvsList.innerHTML = projInvs
          .map((inv) => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; margin-bottom: 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px;">
              <div>
                <b>${escapeHtml(inv.projectName || 'Project')}</b> (invited by ${escapeHtml(inv.inviterName || 'User')} as <i>${inv.role}</i>)
              </div>
              <button onclick="window.handleNotifProject()" class="primary" style="font-size: 11px; padding: 4px 8px;">Review / Go to Projects</button>
            </div>
          `)
          .join('')
      } else {
        els.notifProjectInvsSection.style.display = 'none'
        els.notifProjectInvsList.innerHTML = ''
      }
    }
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}

async function renderTeamsModal(): Promise<void> {
  if (!currentUser) return
  els.teamsErrorBanner.style.display = 'none'
  els.teamsErrorBanner.textContent = ''

  try {
    const [overview, invsRes] = await Promise.all([
      api<{ ok: boolean; joinedTeams: TeamWithDetails[]; availableDomainTeams: Team[] }>('GET', 'teams'),
      api<{ ok: boolean; invitations: TeamInvitation[] }>('GET', 'teams/invitations/pending'),
    ])

    // 1. Pending Invitations
    const invs = invsRes.invitations || []
    if (invs.length > 0) {
      els.pendingInvsSection.style.display = 'block'
      els.pendingInvsList.innerHTML = invs
        .map((inv) => {
          return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px;">
              <div>
                <b>${escapeHtml(inv.teamName || 'Private Team')}</b> (invited by ${escapeHtml(inv.inviterName || 'Admin')} as <i>${inv.role}</i>)
              </div>
              <div style="display: flex; gap: 4px;">
                <button class="primary" onclick="window.acceptTeamInvite('${inv.id}')" style="font-size: 11px; padding: 3px 8px;">Accept</button>
                <button onclick="window.rejectTeamInvite('${inv.id}')" style="font-size: 11px; padding: 3px 8px;">Reject</button>
              </div>
            </div>
          `
        })
        .join('')
    } else {
      els.pendingInvsSection.style.display = 'none'
      els.pendingInvsList.innerHTML = ''
    }

    // 2. Joined Teams
    const joined = overview.joinedTeams || []
    if (joined.length > 0) {
      els.joinedTeamsList.innerHTML = joined
        .map((t) => {
          const badge = t.type === 'domain' ? '🏢 Domain' : '🔒 Private'
          return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; margin-bottom: 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px;">
              <div>
                <div style="font-weight: 600;">${escapeHtml(t.name)}</div>
                <div style="font-size: 11px; color: var(--muted);">${badge} • ${t.memberCount} member${t.memberCount === 1 ? '' : 's'}</div>
              </div>
              <button onclick="window.openTeamDetails('${t.id}')" class="primary" style="font-size: 12px; padding: 4px 10px;">View / Manage</button>
            </div>
          `
        })
        .join('')
    } else {
      els.joinedTeamsList.innerHTML = '<p style="font-size: 12px; color: var(--muted); margin: 6px 0;">You have not joined any teams yet.</p>'
    }

    // 3. Available Domain Teams (to join)
    const avail = overview.availableDomainTeams || []
    if (avail.length > 0) {
      els.availDomainTeamsSection.style.display = 'block'
      els.availDomainTeamsList.innerHTML = avail
        .map((t) => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px;">
            <div>
              <b>${escapeHtml(t.name)}</b> <span style="font-size: 11px; color: var(--muted);">(@${escapeHtml(t.domain || '')})</span>
            </div>
            <button class="primary" onclick="window.joinDomainTeam('${t.id}', '${escapeHtml(t.domain || '')}')" style="font-size: 11px; padding: 3px 8px;">Join</button>
          </div>
        `)
        .join('')
    } else {
      els.availDomainTeamsSection.style.display = 'none'
      els.availDomainTeamsList.innerHTML = ''
    }

    await updateNotificationsBadge()
  } catch (err) {
    els.teamsErrorBanner.textContent = err instanceof Error ? err.message : String(err)
    els.teamsErrorBanner.style.display = 'block'
  }
}

async function openTeamDetails(teamId: string): Promise<void> {
  currentActiveTeamId = teamId
  expelTargetUserId = null
  els.memberExpelPrompt.style.display = 'none'
  els.teamDetailErrorBanner.style.display = 'none'
  els.teamDetailErrorBanner.textContent = ''

  try {
    const res = await api<{ ok: boolean; team: TeamWithDetails }>('GET', `teams/${teamId}`)
    const team = res.team
    els.teamDetailName.textContent = team.name
    els.teamDetailTypeBadge.textContent = team.type === 'domain' ? `Domain (${team.domain})` : 'Private Team'
    els.teamDetailMemberCount.textContent = String(team.memberCount)

    // Member list
    els.teamDetailMemberList.innerHTML = team.members
      .map((m) => {
        const isSelf = currentUser && m.userId === currentUser.id
        const avatar = m.avatarUrl
          ? `<img src="${escapeHtml(m.avatarUrl)}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;" />`
          : `<div class="user-avatar-large" style="width: 24px; height: 24px; font-size: 11px;">${escapeHtml(m.name[0]?.toUpperCase() || '?')}</div>`
        const roleBadge = m.role === 'admin' ? '<span class="badge-primary" style="font-size: 9px;">Admin</span>' : ''
        
        let actions = ''
        if (team.type === 'domain' && !isSelf) {
          actions = `<button onclick="window.promptRemoveMember('${m.userId}', 'domain')" style="font-size: 11px; padding: 2px 6px; color: #e53e3e; border-color: #feb2b2;">Expel</button>`
        } else if (team.type === 'private' && team.currentUserRole === 'admin' && !isSelf) {
          actions = `<button onclick="window.promptRemoveMember('${m.userId}', 'private')" style="font-size: 11px; padding: 2px 6px; color: #e53e3e; border-color: #feb2b2;">Remove</button>`
        }

        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              ${avatar}
              <div>
                <span style="font-weight: 600;">${escapeHtml(m.name)}</span>
                <span style="font-size: 11px; color: var(--muted);">(@${escapeHtml(m.username)})</span>
                ${roleBadge}
                ${isSelf ? '<span style="font-size: 10px; color: var(--link);">(You)</span>' : ''}
              </div>
            </div>
            <div>${actions}</div>
          </div>
        `
      })
      .join('')

    // Pending Team Invitations (for admins/members)
    const pendingInvs = team.pendingInvitations || []
    if (pendingInvs.length > 0) {
      els.teamDetailPendingInvsSection.style.display = 'block'
      els.teamDetailPendingInvsCount.textContent = String(pendingInvs.length)
      els.teamDetailPendingInvsList.innerHTML = pendingInvs
        .map((inv) => {
          const target = inv.targetEmail || (inv.targetUsername ? `@${inv.targetUsername}` : 'Unknown')
          let revokeBtn = ''
          if (team.currentUserRole === 'admin') {
            revokeBtn = `<button onclick="window.revokeTeamInvite('${inv.id}')" style="font-size: 11px; padding: 2px 6px; color: #e53e3e; border-color: #feb2b2;">Revoke</button>`
          }
          return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px;">
              <div>
                <b>${escapeHtml(target)}</b> <span class="badge-primary" style="font-size: 9px;">${inv.role}</span>
                <div style="font-size: 11px; color: var(--muted);">Invited by ${escapeHtml(inv.inviterName || 'Admin')}</div>
              </div>
              ${revokeBtn}
            </div>
          `
        })
        .join('')
    } else {
      els.teamDetailPendingInvsSection.style.display = 'none'
      els.teamDetailPendingInvsList.innerHTML = ''
    }

    // Private team invite section (only for admin)
    if (team.type === 'private' && team.currentUserRole === 'admin') {
      els.teamInviteSection.style.display = 'block'
      els.teamInviteTargetInput.value = ''
    } else {
      els.teamInviteSection.style.display = 'none'
    }

    els.teamDetailsModal.showModal()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    alert(msg)
    els.teamDetailsModal.close()
    await renderTeamsModal()
  }
}

let expelTeamType: 'private' | 'domain' = 'private'

// Global window helpers for inline onclick handlers in modal HTML
declare global {
  interface Window {
    handleNotifTeam: () => Promise<void>
    handleNotifProject: () => Promise<void>

    openTeamDetails: (teamId: string) => Promise<void>
    joinDomainTeam: (teamId: string, domain: string) => Promise<void>
    acceptTeamInvite: (invitationId: string) => Promise<void>
    rejectTeamInvite: (invitationId: string) => Promise<void>
    revokeTeamInvite: (invitationId: string) => Promise<void>
    promptRemoveMember: (targetUserId: string, type: 'private' | 'domain') => Promise<void>

    openProjectDetails: (projectId: string) => Promise<void>
    acceptProjectInvite: (invitationId: string) => Promise<void>
    rejectProjectInvite: (invitationId: string) => Promise<void>
    revokeProjectInvite: (invitationId: string) => Promise<void>
    promptRemoveProjectMember: (targetUserId: string) => Promise<void>
    removeProjectTeam: (teamId: string) => Promise<void>
  }
}

window.handleNotifTeam = async () => {
  els.notificationsModal.close()
  await renderTeamsModal()
  els.teamsModal.showModal()
}

window.handleNotifProject = async () => {
  els.notificationsModal.close()
  await renderProjectsModal()
  els.projectsModal.showModal()
}

window.openTeamDetails = (teamId: string) => openTeamDetails(teamId)

window.revokeTeamInvite = async (invitationId: string) => {
  if (!confirm('Revoke this team invitation?')) return
  try {
    await api('DELETE', `teams/invitations/${invitationId}`)
    setStatus('✓ Team invitation revoked')
    if (currentActiveTeamId) await openTeamDetails(currentActiveTeamId)
    await updateNotificationsBadge()
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}

window.promptRemoveMember = async (targetUserId: string, type: 'private' | 'domain') => {
  if (!currentUser || !currentActiveTeamId) return
  expelTargetUserId = targetUserId
  expelTeamType = type
  els.memberExpelPrompt.style.display = 'block'
  els.memberExpelDevHelper.style.display = 'none'
  els.memberExpelCodeInput.value = ''
  els.memberExpelTargetEmail.textContent = currentUser.defaultEmail

  const purpose = type === 'domain' ? 'domain_team_expel' : 'remove_team_member'
  try {
    const res = await api<{ ok: boolean; email: string; devCode?: string }>('POST', 'auth/request-code', {
      body: { identifier: currentUser.defaultEmail, purpose },
    })
    if (res.devCode) {
      els.memberExpelDevHelper.textContent = `[Dev mode OTP code]: ${res.devCode}`
      els.memberExpelDevHelper.style.display = 'block'
      els.memberExpelCodeInput.value = res.devCode
    }
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}

window.joinDomainTeam = async (teamId: string, domain: string) => {
  if (!currentUser) return
  const matchedEmail = currentUser.emails.find(
    (e) => e.verifiedAt !== null && e.email.toLowerCase().endsWith(`@${domain.toLowerCase()}`),
  )
  if (!matchedEmail) {
    alert(`No verified email matching domain @${domain} found in your account.`)
    return
  }
  try {
    await api('POST', 'teams/join-domain', {
      body: { teamId, contextEmail: matchedEmail.email },
    })
    setStatus(`✓ Joined ${domain} domain team!`)
    await renderTeamsModal()
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}

window.acceptTeamInvite = async (invitationId: string) => {
  if (!currentUser) return
  try {
    await api('POST', `teams/invitations/${invitationId}/accept`, {
      body: { contextEmail: currentUser.defaultEmail },
    })
    setStatus('✓ Accepted team invitation!')
    await renderTeamsModal()
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}

window.rejectTeamInvite = async (invitationId: string) => {
  try {
    await api('POST', `teams/invitations/${invitationId}/reject`)
    setStatus('Invitation rejected')
    await renderTeamsModal()
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}

els.btnTeams.addEventListener('click', () => {
  renderTeamsModal()
  els.newTeamNameInput.value = ''
  els.teamsModal.showModal()
})

els.btnCloseTeamsModal.addEventListener('click', () => els.teamsModal.close())
els.btnCloseTeamDetailsModal.addEventListener('click', () => {
  els.teamDetailsModal.close()
  renderTeamsModal()
})

els.btnCreateTeam.addEventListener('click', () => run(async () => {
  const name = els.newTeamNameInput.value.trim()
  if (!name) {
    alert('Please enter a team name')
    return
  }
  try {
    await api('POST', 'teams', { body: { name } })
    els.newTeamNameInput.value = ''
    setStatus(`✓ Created private team "${name}"`)
    await renderTeamsModal()
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}))

els.btnSendTeamInvite.addEventListener('click', () => run(async () => {
  if (!currentActiveTeamId) return
  const target = els.teamInviteTargetInput.value.trim()
  const role = els.teamInviteRoleSelect.value as 'admin' | 'member'
  if (!target) {
    alert('Please enter a username (@handle) or email')
    return
  }
  try {
    await api('POST', `teams/${currentActiveTeamId}/invite`, {
      body: { target, role },
    })
    els.teamInviteTargetInput.value = ''
    setStatus(`✓ Invitation sent to ${target}`)
    await openTeamDetails(currentActiveTeamId)
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}))

els.btnConfirmMemberExpel.addEventListener('click', () => run(async () => {
  if (!currentActiveTeamId || !expelTargetUserId) return
  const code = els.memberExpelCodeInput.value.trim()
  if (!code) {
    alert('Please enter the 6-digit verification code')
    return
  }
  try {
    if (expelTeamType === 'domain') {
      await api('POST', `teams/${currentActiveTeamId}/expel-domain`, {
        body: { targetUserId: expelTargetUserId, reverificationCode: code },
      })
      setStatus('✓ Member expelled from domain team')
    } else {
      await api('POST', `teams/${currentActiveTeamId}/members/remove`, {
        body: { targetUserId: expelTargetUserId, reverificationCode: code },
      })
      setStatus('✓ Member removed from private team')
    }
    els.memberExpelPrompt.style.display = 'none'
    expelTargetUserId = null
    await openTeamDetails(currentActiveTeamId)
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}))

els.btnCancelMemberExpel.addEventListener('click', () => {
  els.memberExpelPrompt.style.display = 'none'
  expelTargetUserId = null
})

els.btnLeaveTeam.addEventListener('click', () => run(async () => {
  if (!currentActiveTeamId) return
  if (!confirm('Are you sure you want to leave this team?')) return
  try {
    await api('POST', `teams/${currentActiveTeamId}/leave`)
    setStatus('You left the team')
    els.teamDetailsModal.close()
    await renderTeamsModal()
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}))

// ── Projects and Repositories UI Handlers ──

let currentActiveProjectId: string | null = null
let removeProjMemberTargetUserId: string | null = null

async function renderProjectsModal(): Promise<void> {
  els.projectsErrorBanner.style.display = 'none'
  els.projectsErrorBanner.textContent = ''

  try {
    const [projectsRes, invsRes] = await Promise.all([
      api<{ ok: boolean; projects: ProjectWithDetails[] }>('GET', 'projects'),
      api<{ ok: boolean; invitations: Array<ProjectInvitation & { projectName: string; inviterName: string }> }>('GET', 'projects/invitations/pending'),
    ])

    // Populate Context Email selector for new project form
    if (currentUser) {
      const verifiedEmails = currentUser.emails.filter((e) => e.verifiedAt !== null)
      els.newProjectContextEmailSelect.innerHTML = verifiedEmails
        .map((e) => `<option value="${escapeHtml(e.email)}">${escapeHtml(e.email)}</option>`)
        .join('')
    }

    // 1. Pending Invitations
    const invs = invsRes.invitations || []
    if (invs.length > 0) {
      els.pendingProjInvsSection.style.display = 'block'
      els.pendingProjInvsList.innerHTML = invs
        .map((inv) => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px;">
            <div>
              <b>${escapeHtml(inv.projectName || 'Project')}</b> (invited by ${escapeHtml(inv.inviterName || 'User')} as <i>${inv.role}</i>)
            </div>
            <div style="display: flex; gap: 4px;">
              <button class="primary" onclick="window.acceptProjectInvite('${inv.id}')" style="font-size: 11px; padding: 3px 8px;">Accept</button>
              <button onclick="window.rejectProjectInvite('${inv.id}')" style="font-size: 11px; padding: 3px 8px;">Reject</button>
            </div>
          </div>
        `)
        .join('')
    } else {
      els.pendingProjInvsSection.style.display = 'none'
      els.pendingProjInvsList.innerHTML = ''
    }

    // 2. Joined Projects
    const projectsList = projectsRes.projects || []
    if (projectsList.length > 0) {
      els.joinedProjectsList.innerHTML = projectsList
        .map((p) => {
          const roleBadge = p.effectiveRole ? `<span class="badge-primary" style="font-size: 10px; margin-left: 4px;">${p.effectiveRole}</span>` : ''
          const emailInfo = p.currentContextEmail ? `<span style="font-size: 11px; color: var(--muted); margin-left: 6px;">(${escapeHtml(p.currentContextEmail)})</span>` : ''
          return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; margin-bottom: 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px;">
              <div>
                <div style="font-weight: 600;">${escapeHtml(p.name)} ${roleBadge}</div>
                <div style="font-size: 11px; color: var(--muted);">${escapeHtml(p.slug)} ${emailInfo} • ${p.members.length} direct member${p.members.length === 1 ? '' : 's'}</div>
              </div>
              <button onclick="window.openProjectDetails('${p.id}')" class="primary" style="font-size: 12px; padding: 4px 10px;">View / Manage</button>
            </div>
          `
        })
        .join('')
    } else {
      els.joinedProjectsList.innerHTML = '<p style="font-size: 12px; color: var(--muted); margin: 6px 0;">You do not have any projects yet. Create one below!</p>'
    }

    await updateNotificationsBadge()
  } catch (err) {
    els.projectsErrorBanner.textContent = err instanceof Error ? err.message : String(err)
    els.projectsErrorBanner.style.display = 'block'
  }
}

async function openProjectDetails(projectId: string): Promise<void> {
  currentActiveProjectId = projectId
  removeProjMemberTargetUserId = null
  els.projectMemberRemovePrompt.style.display = 'none'
  els.projectDetailErrorBanner.style.display = 'none'
  els.projectDetailErrorBanner.textContent = ''

  try {
    const res = await api<{ ok: boolean; project: ProjectWithDetails }>('GET', `projects/${projectId}`)
    const project = res.project
    els.projectDetailName.textContent = project.name
    els.projectDetailSlug.textContent = `Slug: ${project.slug} | Git context: ${project.currentContextEmail || 'none'}`
    els.projectDetailRoleBadge.textContent = project.effectiveRole ? `Role: ${project.effectiveRole.toUpperCase()}` : 'Member'
    els.projectDetailMemberCount.textContent = String(project.members.length)
    els.projectDetailTeamCount.textContent = String(project.teams.length)

    // Direct Members
    els.projectDetailMemberList.innerHTML = project.members
      .map((m) => {
        const isSelf = currentUser && m.userId === currentUser.id
        const avatar = m.avatarUrl
          ? `<img src="${escapeHtml(m.avatarUrl)}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;" />`
          : `<div class="user-avatar-large" style="width: 24px; height: 24px; font-size: 11px;">${escapeHtml(m.name[0]?.toUpperCase() || '?')}</div>`
        const roleBadge = `<span class="badge-primary" style="font-size: 9px;">${m.role}</span>`

        let removeBtn = ''
        if (project.effectiveRole === 'owner' && !isSelf) {
          removeBtn = `<button onclick="window.promptRemoveProjectMember('${m.userId}')" style="font-size: 11px; padding: 2px 6px; color: #e53e3e; border-color: #feb2b2;">Remove</button>`
        }

        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              ${avatar}
              <div>
                <div style="font-weight: 500;">${escapeHtml(m.name)} <span style="color: var(--muted); font-size: 11px;">@${escapeHtml(m.username)}</span> ${roleBadge}</div>
                <div style="font-size: 11px; color: var(--muted);">${escapeHtml(m.contextEmail)}</div>
              </div>
            </div>
            ${removeBtn}
          </div>
        `
      })
      .join('')

    // Git Signature Email Selector for current user
    if (currentUser) {
      const verifiedEmails = currentUser.emails.filter((e) => e.verifiedAt !== null)
      const currentContext = project.currentContextEmail || currentUser.defaultEmail
      els.projectMyContextEmailSelect.innerHTML = verifiedEmails
        .map((e) => `<option value="${escapeHtml(e.email)}" ${e.email.toLowerCase() === currentContext.toLowerCase() ? 'selected' : ''}>${escapeHtml(e.email)}</option>`)
        .join('')
      els.projectContextEmailSection.style.display = 'block'
    } else {
      els.projectContextEmailSection.style.display = 'none'
    }

    // Pending Invitations (for owners/members)
    const pendingInvs = project.pendingInvitations || []
    if (pendingInvs.length > 0) {
      els.projectDetailPendingInvsSection.style.display = 'block'
      els.projectDetailPendingInvsCount.textContent = String(pendingInvs.length)
      els.projectDetailPendingInvsList.innerHTML = pendingInvs
        .map((inv) => {
          const target = inv.targetEmail || (inv.targetUsername ? `@${inv.targetUsername}` : 'Unknown')
          let revokeBtn = ''
          if (project.effectiveRole === 'owner') {
            revokeBtn = `<button onclick="window.revokeProjectInvite('${inv.id}')" style="font-size: 11px; padding: 2px 6px; color: #e53e3e; border-color: #feb2b2;">Revoke</button>`
          }
          return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px;">
              <div>
                <b>${escapeHtml(target)}</b> <span class="badge-primary" style="font-size: 9px;">${inv.role}</span>
                <div style="font-size: 11px; color: var(--muted);">Invited by ${escapeHtml(inv.inviterName || 'User')}</div>
              </div>
              ${revokeBtn}
            </div>
          `
        })
        .join('')
    } else {
      els.projectDetailPendingInvsSection.style.display = 'none'
      els.projectDetailPendingInvsList.innerHTML = ''
    }

    // Assigned Teams
    if (project.teams.length > 0) {
      els.projectDetailTeamList.innerHTML = project.teams
        .map((t) => {
          let removeTeamBtn = ''
          if (project.effectiveRole === 'owner') {
            removeTeamBtn = `<button onclick="window.removeProjectTeam('${t.teamId}')" style="font-size: 11px; padding: 2px 6px; color: #e53e3e; border-color: #feb2b2;">Remove</button>`
          }
          return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px;">
              <div>
                <b>${escapeHtml(t.teamName)}</b> <span class="badge-primary" style="font-size: 9px;">${t.role}</span>
                <div style="font-size: 11px; color: var(--muted);">${t.teamType === 'domain' ? '🏢 Domain' : '🔒 Private'} • ${t.memberCount} member${t.memberCount === 1 ? '' : 's'}</div>
              </div>
              ${removeTeamBtn}
            </div>
          `
        })
        .join('')
    } else {
      els.projectDetailTeamList.innerHTML = '<p style="font-size: 12px; color: var(--muted); margin: 4px 0;">No teams assigned yet.</p>'
    }

    // Owner controls
    if (project.effectiveRole === 'owner') {
      els.projectOwnerSection.style.display = 'block'
      // Populate available teams to assign
      const teamsRes = await api<{ ok: boolean; joinedTeams: any[] }>('GET', 'teams/overview')
      const userTeams = teamsRes.joinedTeams || []
      els.projectAssignTeamSelect.innerHTML = userTeams
        .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)
        .join('')
    } else {
      els.projectOwnerSection.style.display = 'none'
    }

    if (els.projectsModal.open) els.projectsModal.close()
    els.projectDetailsModal.showModal()
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
    if (els.projectDetailsModal.open) els.projectDetailsModal.close()
    await renderProjectsModal()
  }
}

window.openProjectDetails = (id: string) => openProjectDetails(id)

window.acceptProjectInvite = async (invitationId: string) => {
  try {
    const verifiedEmails = currentUser?.emails.filter((e) => e.verifiedAt !== null) || []
    let contextEmail: string | undefined = currentUser?.defaultEmail
    if (verifiedEmails.length > 1) {
      const choice = prompt(
        `Select contextual email for Git commits in this project:\n${verifiedEmails.map((e) => e.email).join('\n')}`,
        currentUser?.defaultEmail,
      )
      if (choice) contextEmail = choice.trim()
    }
    await api('POST', `projects/invitations/${invitationId}/accept`, { body: { contextEmail } })
    setStatus('✓ Joined project')
    await renderProjectsModal()
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}

window.rejectProjectInvite = async (invitationId: string) => {
  if (!confirm('Reject this project invitation?')) return
  try {
    await api('POST', `projects/invitations/${invitationId}/reject`)
    setStatus('Project invitation rejected')
    await renderProjectsModal()
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}

window.revokeProjectInvite = async (invitationId: string) => {
  if (!confirm('Revoke this project invitation?')) return
  try {
    await api('DELETE', `projects/invitations/${invitationId}`)
    setStatus('✓ Invitation revoked')
    if (currentActiveProjectId) await openProjectDetails(currentActiveProjectId)
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}

window.promptRemoveProjectMember = async (targetUserId: string) => {
  if (!currentActiveProjectId || !currentUser) return
  removeProjMemberTargetUserId = targetUserId
  els.projectMemberRemovePrompt.style.display = 'block'
  els.projMemberRemoveDevHelper.style.display = 'none'
  els.projMemberRemoveTargetEmail.textContent = currentUser.defaultEmail || ''
  els.projMemberRemoveCodeInput.value = ''

  try {
    const res = await api<{ ok: boolean; email: string; devCode?: string }>('POST', 'auth/request-code', {
      body: { identifier: currentUser.defaultEmail, purpose: 'remove_project_member' },
    })
    if (res.devCode) {
      els.projMemberRemoveDevHelper.textContent = `[Dev mode OTP code]: ${res.devCode}`
      els.projMemberRemoveDevHelper.style.display = 'block'
      els.projMemberRemoveCodeInput.value = res.devCode
    }
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}

window.removeProjectTeam = async (teamId: string) => {
  if (!currentActiveProjectId) return
  if (!confirm('Remove this team from the project? Members will lose inherited project access.')) return
  try {
    await api('DELETE', `projects/${currentActiveProjectId}/teams/${teamId}`)
    setStatus('✓ Team removed from project')
    await openProjectDetails(currentActiveProjectId)
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

let slugManuallyEdited = false
els.newProjectSlugInput.addEventListener('input', () => {
  slugManuallyEdited = els.newProjectSlugInput.value.trim().length > 0
})

els.newProjectNameInput.addEventListener('input', () => {
  if (!slugManuallyEdited) {
    els.newProjectSlugInput.value = slugify(els.newProjectNameInput.value)
  }
})

els.btnProjects.addEventListener('click', () => {
  slugManuallyEdited = false
  renderProjectsModal()
  els.newProjectNameInput.value = ''
  els.newProjectSlugInput.value = ''
  els.newProjectDescInput.value = ''
  els.projectsModal.showModal()
})

els.btnCloseProjectsModal.addEventListener('click', () => els.projectsModal.close())
els.btnCloseProjectDetailsModal.addEventListener('click', () => {
  els.projectDetailsModal.close()
  renderProjectsModal()
})

els.btnCreateProject.addEventListener('click', () => run(async () => {
  const name = els.newProjectNameInput.value.trim()
  const slug = els.newProjectSlugInput.value.trim() || undefined
  const description = els.newProjectDescInput.value.trim() || undefined
  const contextEmail = els.newProjectContextEmailSelect.value.trim() || undefined

  if (!name) {
    alert('Please enter a project name')
    return
  }

  try {
    await api('POST', 'projects', {
      body: { name, slug, description, contextEmail },
    })
    els.newProjectNameInput.value = ''
    els.newProjectSlugInput.value = ''
    els.newProjectDescInput.value = ''
    setStatus(`✓ Created project "${name}"`)
    await renderProjectsModal()
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}))

els.btnUpdateProjectContextEmail.addEventListener('click', () => run(async () => {
  if (!currentActiveProjectId) return
  const newEmail = els.projectMyContextEmailSelect.value.trim()
  if (!newEmail) return
  try {
    await api('POST', `projects/${currentActiveProjectId}/context-email`, {
      body: { contextEmail: newEmail },
    })
    setStatus(`✓ Git signature email updated to ${newEmail}`)
    await openProjectDetails(currentActiveProjectId)
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}))

els.btnAssignProjectTeam.addEventListener('click', () => run(async () => {
  if (!currentActiveProjectId) return
  const teamId = els.projectAssignTeamSelect.value
  const role = els.projectAssignTeamRoleSelect.value as any
  if (!teamId) {
    alert('Please select a team to assign')
    return
  }
  try {
    await api('POST', `projects/${currentActiveProjectId}/teams`, {
      body: { teamId, role },
    })
    setStatus('✓ Team assigned to project')
    await openProjectDetails(currentActiveProjectId)
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}))

els.btnSendProjectInvite.addEventListener('click', () => run(async () => {
  if (!currentActiveProjectId) return
  const target = els.projectInviteTargetInput.value.trim()
  const role = els.projectInviteRoleSelect.value as any
  if (!target) {
    alert('Please enter a username (@handle) or email')
    return
  }
  try {
    await api('POST', `projects/${currentActiveProjectId}/invite`, {
      body: { target, role },
    })
    els.projectInviteTargetInput.value = ''
    setStatus(`✓ Project invitation sent to ${target}`)
    await openProjectDetails(currentActiveProjectId)
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}))

els.btnConfirmProjMemberRemove.addEventListener('click', () => run(async () => {
  if (!currentActiveProjectId || !removeProjMemberTargetUserId) return
  const code = els.projMemberRemoveCodeInput.value.trim()
  if (!code) {
    alert('Please enter the 6-digit verification code')
    return
  }
  try {
    await api('POST', `projects/${currentActiveProjectId}/members/remove`, {
      body: { targetUserId: removeProjMemberTargetUserId, reverificationCode: code },
    })
    setStatus('✓ Member removed from project')
    els.projectMemberRemovePrompt.style.display = 'none'
    removeProjMemberTargetUserId = null
    await openProjectDetails(currentActiveProjectId)
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}))

els.btnCancelProjMemberRemove.addEventListener('click', () => {
  els.projectMemberRemovePrompt.style.display = 'none'
  removeProjMemberTargetUserId = null
})

els.btnLeaveProject.addEventListener('click', () => run(async () => {
  if (!currentActiveProjectId) return
  if (!confirm('Are you sure you want to leave this project?')) return
  try {
    await api('POST', `projects/${currentActiveProjectId}/leave`)
    setStatus('You left the project')
    els.projectDetailsModal.close()
    await renderProjectsModal()
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  }
}))

els.btnNotifications.addEventListener('click', () => run(async () => {
  await renderNotificationsModal()
  els.notificationsModal.showModal()
}))

els.btnCloseNotificationsModal.addEventListener('click', () => {
  els.notificationsModal.close()
})

let pendingAuthorizeParams: { port: string; name: string; challenge: string; state: string } | null = null

async function openAuthorizeAgentModal(params: { port: string; name: string; challenge: string; state: string }): Promise<void> {
  pendingAuthorizeParams = params
  if (!currentUser) {
    // Unauthenticated visitor -> open Sign In / Sign Up modal
    els.authErrorBanner.style.display = 'none'
    els.authStepEmail.style.display = 'block'
    els.authStepRegister.style.display = 'none'
    els.authStepCode.style.display = 'none'
    if (!els.authModal.open) els.authModal.showModal()
    return
  }

  els.authAgentClientName.textContent = params.name || 'AI Client (CLI / MCP)'
  els.authAgentErrorBanner.style.display = 'none'
  els.authAgentSuccessBox.style.display = 'none'
  els.authAgentBtnRow.style.display = 'flex'
  els.authAgentProjectMatrix.innerHTML = '<div style="color: var(--muted); padding: 8px;">Loading your projects...</div>'

  if (!els.authorizeAgentModal.open) {
    els.authorizeAgentModal.showModal()
  }

  try {
    const res = await api<{ ok: true; projects: Array<{ id: string; name: string; slug: string; effectiveRole: string }> }>('GET', 'projects')
    const userProjects = res.projects || []
    if (userProjects.length === 0) {
      els.authAgentProjectMatrix.innerHTML = '<div style="color: var(--muted); padding: 8px;">You do not belong to any projects yet. Create or join a project first.</div>'
      return
    }

    els.authAgentProjectMatrix.innerHTML = userProjects.map((p) => {
      const isOwner = p.effectiveRole === 'owner'
      const isEditor = p.effectiveRole === 'editor' || isOwner
      const isCommenter = p.effectiveRole === 'commenter' || isEditor

      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 4px; border-bottom: 1px solid var(--border);">
          <div>
            <b style="font-size: 12px;">${p.name}</b>
            <div style="font-size: 11px; color: var(--muted);">${p.slug} • Your role: <b>${p.effectiveRole}</b></div>
          </div>
          <select class="agent-proj-scope-select" data-proj-id="${p.id}" style="font-size: 11px; border-radius: 4px; padding: 2px 6px; border: 1px solid var(--border); background: var(--bg); color: var(--fg);">
            <option value="none">None (No Access)</option>
            <option value="viewer">Viewer (Read only)</option>
            <option value="commenter" ${!isCommenter ? 'disabled' : ''}>Commenter (Read & Comment)</option>
            <option value="editor" ${!isEditor ? 'disabled' : ''} selected>Editor (Read, Edit & Comment)</option>
          </select>
        </div>
      `
    }).join('')
  } catch (err) {
    els.authAgentProjectMatrix.innerHTML = `<div style="color: #ef4444; font-size: 11px;">Error loading projects: ${err instanceof Error ? err.message : String(err)}</div>`
  }
}

els.btnCancelAuthorizeAgent.addEventListener('click', () => {
  els.authorizeAgentModal.close()
  pendingAuthorizeParams = null
})

els.btnCloseAuthorizeAgentSuccess.addEventListener('click', () => {
  els.authorizeAgentModal.close()
  pendingAuthorizeParams = null
})

els.btnSubmitAuthorizeAgent.addEventListener('click', () => run(async () => {
  if (!pendingAuthorizeParams) return
  const { port, name, challenge, state } = pendingAuthorizeParams

  const selects = els.authAgentProjectMatrix.querySelectorAll<HTMLSelectElement>('.agent-proj-scope-select')
  const projectScopes: Array<{ projectId: string; maxRole: 'editor' | 'commenter' | 'viewer' }> = []

  selects.forEach((sel) => {
    const projId = sel.getAttribute('data-proj-id')
    const roleVal = sel.value
    if (projId && (roleVal === 'editor' || roleVal === 'commenter' || roleVal === 'viewer')) {
      projectScopes.push({ projectId: projId, maxRole: roleVal })
    }
  })

  try {
    els.authAgentErrorBanner.style.display = 'none'
    const res = await api<{ ok: true; code: string }>('POST', 'auth/agent-grants', {
      body: {
        agentName: name || 'CLI Agent',
        codeChallenge: challenge,
        projectScopes,
      },
    })

    if (res.code) {
      // Trigger callback to local loopback server
      const callbackUrl = `http://127.0.0.1:${port}/callback?code=${encodeURIComponent(res.code)}&state=${encodeURIComponent(state)}`
      
      // Perform loopback fetch to trigger callback
      fetch(callbackUrl, { mode: 'no-cors' }).catch(() => {})

      els.authAgentBtnRow.style.display = 'none'
      els.authAgentSuccessBox.style.display = 'block'
      setStatus('✓ AI Agent authorized successfully')
    }
  } catch (err) {
    els.authAgentErrorBanner.textContent = err instanceof Error ? err.message : String(err)
    els.authAgentErrorBanner.style.display = 'block'
  }
}))

async function handleUrlHashActions(): Promise<void> {
  const hash = window.location.hash
  if (hash.startsWith('#authorize-agent')) {
    const queryPart = hash.includes('?') ? hash.split('?')[1] : ''
    const params = new URLSearchParams(queryPart)
    const port = params.get('port') || '0'
    const name = params.get('name') || 'AI Agent'
    const challenge = params.get('challenge') || ''
    const state = params.get('state') || ''
    if (port && challenge) {
      await openAuthorizeAgentModal({ port, name, challenge, state })
    }
    return
  }
  if (hash === '#pending' || hash === '#notifications') {
    if (currentUser) {
      if (els.authModal.open) els.authModal.close()
      await renderNotificationsModal()
      if (!els.notificationsModal.open) els.notificationsModal.showModal()
    } else {
      // Unauthenticated visitor -> open Sign In / Sign Up modal
      els.authErrorBanner.style.display = 'none'
      els.authStepEmail.style.display = 'block'
      els.authStepRegister.style.display = 'none'
      els.authStepCode.style.display = 'none'
      if (!els.authModal.open) els.authModal.showModal()
    }
  }
}

window.addEventListener('hashchange', () => {
  handleUrlHashActions()
})

run(async () => {
  await refreshAuthUI()
  await boot()
  await handleUrlHashActions()
})



