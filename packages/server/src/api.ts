import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LocalGitBackend, type Author, type RepoBackend } from '@md4lp/repo'
import { CommentStore, type Comment } from '@md4lp/comments'
import { createAnchor, resolveAnchor, reanchor, type AnchorResolution } from '@md4lp/anchor'
import { canonicalize } from '@md4lp/canonicalizer'
import { z } from 'zod'
import { type Config, DEFAULT_CONFIG } from './config'
import { resolveCaller } from './identity'
import { AuthService } from './auth'
import { TeamService } from './teams/service'
import { MemoryTeamStore } from './teams/store'
import { ProjectService } from './projects/service'
import { MemoryProjectStore } from './projects/store'
import * as schemas from './schemas'
const SAMPLE: Record<string, string> = {
  'welcome.md': [
    '# Welcome to md4lp 🌍',
    '',
    'A WYSIWYG Markdown service backed by git. Editing must be **pleasant** and docs render _nicely_.',
    '',
    'See the [scope](scope.md) for what v1 covers.',
    '',
    '> Reviewers mostly comment; the owner edits.',
    '',
  ].join('\n'),
  'scope.md': [
    '# Scope',
    '',
    '| Capability | v1  | Notes                  |',
    '| :--------- | :-: | :--------------------- |',
    '| Edit view  | yes | Crepe WYSIWYG          |',
    '| Review     | yes | render + comments      |',
    '| Tables     | yes | editable in the editor |',
    '',
    '- [ ] which editor engine for byte-exact',
    '- [x] two-view model validated',
    '',
  ].join('\n'),
  'reading-demo.md': [
    '# Reading demo',
    '',
    'The Review view renders code and math for comfortable reading. Use the outline on the right to jump.',
    '',
    '## Code',
    '',
    'Fenced blocks get syntax highlighting:',
    '',
    '```ts',
    'function greet(name: string): string {',
    '  return `Hello, ${name}!`',
    '}',
    '```',
    '',
    '## Math',
    '',
    'The mass–energy relation is $E = mc^2$, and inline sums like $\\sum_{i=1}^{n} i$ render too.',
    '',
    '$$',
    '\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
    '$$',
    '',
    '## Feature summary',
    '',
    '| Feature             | Status |',
    '| :------------------ | :----: |',
    '| Syntax highlighting | yes    |',
    '| Math (KaTeX)        | yes    |',
    '| Reading typography  | yes    |',
    '| Outline / TOC       | yes    |',
    '',
  ].join('\n'),
}

const SYSTEM: Author = { name: 'md4lp', email: 'md4lp@local' }

export interface ApiResponse {
  status: number
  json: unknown
}

/**
 * A change worth pushing to live views (D20). `doc` = the document text changed (edit branch or main);
 * `comments` = a thread changed; `lock` = the edit lock for `file` changed hands (`editor` = the new
 * holder, or null when released/expired). Clients filter by `file` and refresh the relevant view.
 */
export interface Md4lpEvent {
  type: 'doc' | 'comments' | 'lock'
  file: string
  /** The user who caused the change. Clients ignore their own echoes (they already rendered locally). */
  by: string
  editor?: string | null
}

export type EventListener = (e: Md4lpEvent) => void

export interface AuthContext {
  token?: string
  userId?: string
  email?: string
  name?: string
  agentSession?: import('./auth/types').AgentSession
}

export interface Api {
  handle(
    method: string,
    pathname: string,
    query: URLSearchParams,
    body: unknown,
    user: string,
    authContext?: AuthContext,
  ): Promise<ApiResponse>
  /** Subscribe to live events (SSE backing). Returns an unsubscribe function. */
  subscribe(listener: EventListener): () => void
  auth: AuthService
  teams: TeamService
  projects: ProjectService
}

/** Minimal in-process pub/sub — the single serialization point already lives in @md4lp/repo (D18). */
function createEventBus(): { emit: EventListener; subscribe: Api['subscribe'] } {
  const listeners = new Set<EventListener>()
  return {
    emit: (e) => {
      for (const l of listeners) {
        try {
          l(e)
        } catch {
          /* a slow/broken subscriber must not break the mutation that emitted */
        }
      }
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

export function createApi(
  repoDir: string,
  config: Config = DEFAULT_CONFIG,
  auth: AuthService = new AuthService(),
  teams: TeamService = new TeamService(new MemoryTeamStore(), auth),
  projects: ProjectService = new ProjectService(new MemoryProjectStore(), auth, teams, join(repoDir, '.projects')),
): Api {
  let cached: Promise<{ repo: RepoBackend; store: CommentStore }> | null = null
  const bus = createEventBus()

  const ready = (): Promise<{ repo: RepoBackend; store: CommentStore }> => {
    if (!cached) cached = init(repoDir, config)
    return cached
  }

  // ── Edit lock (D20): one editor at a time per file, server-arbitrated (D18 single process). ──
  // State lives only in memory; an idle holder (no heartbeat within the timeout) is silently expired so
  // the next editor can take over. Heartbeats are interaction-driven on the client.
  const LOCK_TIMEOUT_MS = config.lockTimeoutMs ?? 30_000
  const locks = new Map<string, { editor: string; lastHeartbeat: number }>()
  const expired = (l: { lastHeartbeat: number }): boolean => Date.now() - l.lastHeartbeat > LOCK_TIMEOUT_MS
  /** Who, if anyone, currently holds a live (non-expired) lock on `path`. */
  const heldBy = (path: string): string | undefined => {
    const l = locks.get(path)
    return l && !expired(l) ? l.editor : undefined
  }
  const touch = (path: string, user: string): void => {
    const l = locks.get(path)
    if (l && l.editor === user) l.lastHeartbeat = Date.now()
  }
  /** The version a viewer sees for `path`: the live edit branch while a lock is held, else main. */
  const viewerBranch = (path: string): string => (heldBy(path) ? editBranch(path) : 'main')
  const locked = (editor: string | undefined): ApiResponse => ({
    status: 409,
    json: { error: `document is being edited by ${editor ?? 'another user'}`, editor: editor ?? null },
  })

  /** Consolidate an editor's in-flight work for `path` onto main as a single content-copy commit (D20). */
  const consolidate = async (repo: RepoBackend, path: string, editor: string): Promise<void> => {
    const eb = editBranch(path)
    const ebHead = await repo.head(eb)
    if (!ebHead) return // nothing was ever written on the edit branch
    if (ebHead === (await repo.head('main'))) return // edit branch == main → no changes since fork
    const content = await repo.readFile(eb, path)
    const { author } = resolveCaller(editor, config)
    await repo.writeFiles('main', [{ path, content }], `edit ${path}`, author)
  }

  const handle = async (
    method: string,
    pathname: string,
    query: URLSearchParams,
    body: unknown,
    user: string,
    authContext?: AuthContext,
  ): Promise<ApiResponse> => {
    const { repo, store } = await ready()
    const { role, author } = resolveCaller(user, config)
    const path = query.get('path') ?? (isRecord(body) ? String(body.path ?? '') : '')
    // Stamp every emitted event with the actor so clients can skip their own echoes.
    const emit = (e: Omit<Md4lpEvent, 'by'>): void => bus.emit({ ...e, by: user })

    const key = `${method} ${pathname}`
    try {
      switch (key) {
        case 'GET /api/state': {
          // Files are listed from main (the consolidated truth); there are no per-user branches (D20).
          const files = (await repo.listFiles('main')).filter(isDocFile)
          return ok({ user, role, users: Object.entries(config.users).map(([id, u]) => ({ id, role: u.role })), branch: 'main', files })
        }
        case 'GET /api/file': {
          // Default to the live version (edit branch while a lock is held, else main); ?branch= overrides.
          const branch = query.get('branch') ?? viewerBranch(path)
          return ok({ path, branch, content: await repo.readFile(branch, path), lock: { editor: heldBy(path) ?? null } })
        }
        case 'PUT /api/file': {
          // Auto-save target: writes go to the ephemeral edit branch. You may write as long as you are
          // still the lock's owner in the map — even if it idled past the timeout, you are not bumped
          // until someone else actually takes over (mirrors heartbeat/release; tolerates a slow client).
          if (role !== 'editor') return forbidden('commenters cannot edit')
          const l = locks.get(path)
          if (!l || l.editor !== user) return locked(heldBy(path))
          const b = schemas.putFileBody.parse(body)
          const content = canonicalize(b.content)
          const oid = await repo.writeFiles(editBranch(path), [{ path, content }], b.message ?? `edit ${path}`, author)
          touch(path, user) // a save is interaction → keep the lock alive
          emit({ type: 'doc', file: path })
          return ok({ oid, content })
        }
        case 'POST /api/lock/acquire': {
          if (role !== 'editor') return forbidden('commenters cannot edit')
          const holder = heldBy(path)
          if (holder && holder !== user) return locked(holder)
          // Take over: consolidate a *different* idle prior holder's work first so it is not lost.
          const prev = locks.get(path)
          if (prev && prev.editor !== user) await consolidate(repo, path, prev.editor)
          await repo.resetBranch(editBranch(path), 'main') // fresh scratch forked from the consolidated truth
          locks.set(path, { editor: user, lastHeartbeat: Date.now() })
          emit({ type: 'lock', file: path, editor: user })
          return ok({ branch: editBranch(path), editor: user })
        }
        case 'POST /api/lock/heartbeat': {
          const l = locks.get(path)
          if (!l || l.editor !== user) return locked(heldBy(path)) // you were bumped (or never held it)
          l.lastHeartbeat = Date.now()
          return ok({ ok: true, editor: user })
        }
        case 'POST /api/lock/release': {
          // Publish / done editing: consolidate the edit branch to main and free the lock.
          const l = locks.get(path)
          if (!l || l.editor !== user) return locked(heldBy(path))
          await consolidate(repo, path, user)
          locks.delete(path)
          emit({ type: 'doc', file: path })
          emit({ type: 'lock', file: path, editor: null })
          return ok({ ok: true })
        }
        case 'GET /api/comments': {
          // Comments anchor to MAIN — the stable coordinate system (D20). Aggregate every creator's
          // sidecar (model A) and re-anchor each thread against main, whatever version the viewer watches.
          const mainMd = await repo.readFile('main', path).catch(() => '')
          const all: Array<{ owner: string; comment: Comment; resolution: AnchorResolution }> = []
          for (const creator of Object.keys(config.users)) {
            const comments = await store.list(commentsBranch(creator), path, creator)
            for (const comment of comments) {
              const oldMd = await repo.readFile(comment.commit, path).catch(() => mainMd)
              const resolution = oldMd === mainMd ? resolveAnchor(mainMd, comment.anchor) : reanchor(oldMd, mainMd, comment.anchor)
              all.push({ owner: creator, comment, resolution })
            }
          }
          return ok({ comments: all })
        }
        case 'POST /api/comment': {
          // Comments are created against MAIN (stable), never the shifting/ephemeral edit branch (D20).
          const b = schemas.commentBody.parse(body)
          const mainMd = await repo.readFile('main', path)
          const anchor = createAnchor(mainMd, b.start, b.end)
          const commit = (await repo.head('main'))!
          const comment = await store.add(commentsBranch(user), path, user, author, { anchor, commit, body: b.body, suggestion: b.suggestion })
          emit({ type: 'comments', file: path })
          return ok({ comment })
        }
        case 'POST /api/reply': {
          // Reply targets a node (comment or nested reply) by id; written to the thread CREATOR's branch.
          const b = schemas.replyBody.parse(body)
          await store.addReply(commentsBranch(b.owner), path, b.owner, b.parentId, author, b.body)
          emit({ type: 'comments', file: path })
          return ok({ ok: true })
        }
        case 'POST /api/edit': {
          const b = schemas.editBody.parse(body)
          const result = await store.editBody(commentsBranch(b.owner), path, b.owner, b.nodeId, author, b.body)
          if (result === 'forbidden') return forbidden('only the author can edit this message')
          if (result === 'conflict') return { status: 409, json: { error: 'someone replied; this message can no longer be edited' } }
          if (result === 'notfound') return { status: 404, json: { error: 'message not found' } }
          emit({ type: 'comments', file: path })
          return ok({ ok: true })
        }
        case 'POST /api/react': {
          const b = schemas.reactBody.parse(body)
          await store.toggleReaction(commentsBranch(b.owner), path, b.owner, b.nodeId, author, b.emoji)
          emit({ type: 'comments', file: path })
          return ok({ ok: true })
        }
        case 'POST /api/suggestion/apply': {
          // Applying a suggestion is a discrete edit committed straight to main, but only when no OTHER
          // editor is mid-session (would clobber their edit branch on release).
          if (role !== 'editor') return forbidden('only editors can apply suggestions')
          const holder = heldBy(path)
          if (holder && holder !== user) return locked(holder)
          const b = schemas.suggestionRefBody.parse(body)
          const comment = (await store.list(commentsBranch(b.owner), path, b.owner)).find((c) => c.id === b.commentId)
          if (!comment || comment.suggestion === undefined) return { status: 400, json: { error: 'no such suggestion' } }
          const mainMd = await repo.readFile('main', path)
          const oldMd = await repo.readFile(comment.commit, path).catch(() => mainMd)
          const res = oldMd === mainMd ? resolveAnchor(mainMd, comment.anchor) : reanchor(oldMd, mainMd, comment.anchor)
          if (res.status === 'orphaned' || res.start === undefined || res.end === undefined) {
            return { status: 409, json: { error: 'anchor lost; cannot apply suggestion' } }
          }
          const newMd = canonicalize(mainMd.slice(0, res.start) + comment.suggestion + mainMd.slice(res.end))
          const oid = await repo.writeFiles('main', [{ path, content: newMd }], `apply suggestion ${b.commentId}`, author)
          await store.setStatus(commentsBranch(b.owner), path, b.owner, author, b.commentId, 'resolved')
          emit({ type: 'doc', file: path })
          emit({ type: 'comments', file: path })
          return ok({ applied: true, oid })
        }
        case 'POST /api/suggestion/reject': {
          if (role !== 'editor') return forbidden('only editors can reject suggestions')
          const b = schemas.suggestionRefBody.parse(body)
          await store.setStatus(commentsBranch(b.owner), path, b.owner, author, b.commentId, 'resolved')
          emit({ type: 'comments', file: path })
          return ok({ rejected: true })
        }
        case 'POST /api/auth/lookup': {
          const b = schemas.lookupIdentifierBody.parse(body)
          const res = await auth.lookupIdentifier(b.identifier)
          return ok(res)
        }
        case 'POST /api/auth/check-username': {
          const b = schemas.checkUsernameBody.parse(body)
          const res = await auth.checkUsernameAvailability(b.username)
          return ok(res)
        }
        case 'POST /api/auth/request-code': {
          const b = schemas.requestCodeBody.parse(body)
          const res = await auth.requestCode({
            identifier: b.identifier,
            purpose: b.purpose,
            name: b.name,
            username: b.username,
            metadata: b.metadata,
          })
          return ok(res)
        }
        case 'POST /api/auth/verify-code': {
          const b = schemas.verifyCodeBody.parse(body)
          const res = await auth.verifyCodeAndLogin({
            identifier: b.identifier,
            purpose: b.purpose,
            code: b.code,
            name: b.name,
            username: b.username,
          })
          if (!res.ok) return badRequest(res.error, { attemptsLeft: res.attemptsLeft })
          if (res.user.defaultEmail) {
            await teams.ensureDomainTeamForEmail(res.user.defaultEmail)
          }
          return ok(res)
        }
        case 'GET /api/auth/me': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const profile = await auth.getUserProfile(authContext.userId)
          if (!profile) return unauthorized('user not found')
          return ok({ ok: true, user: profile, currentEmail: authContext.email })
        }
        case 'PATCH /api/auth/profile': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const b = schemas.updateProfileBody.parse(body)
          const res = await auth.updateProfile(authContext.userId, b)
          if (!res.ok) return badRequest(res.error)
          return ok(res)
        }
        case 'POST /api/auth/emails/request-add': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const b = schemas.emailOnlyBody.parse(body)
          const res = await auth.requestAddEmail({ userId: authContext.userId, newEmail: b.email })
          return ok(res)
        }
        case 'POST /api/auth/emails/verify-add': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const b = schemas.verifyAddEmailBody.parse(body)
          const res = await auth.verifyAddEmail({ userId: authContext.userId, newEmail: b.email, code: b.code })
          if (!res.ok) return badRequest(res.error, { attemptsLeft: res.attemptsLeft })
          await teams.ensureDomainTeamForEmail(b.email)
          return ok(res)
        }
        case 'POST /api/auth/emails/primary': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const b = schemas.emailOnlyBody.parse(body)
          const res = await auth.setPrimaryEmail(authContext.userId, b.email)
          if (!res.ok) return badRequest(res.error)
          return ok(res)
        }
        case 'DELETE /api/auth/emails': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const b = schemas.emailOnlyBody.parse(body)
          const res = await auth.removeEmail(authContext.userId, b.email)
          if (!res.ok) return badRequest(res.error)
          return ok(res)
        }
        case 'POST /api/auth/logout': {
          if (authContext?.token) {
            await auth.logout(authContext.token)
          }
          return ok({ ok: true })
        }
        case 'GET /api/teams': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const res = await teams.listTeamsOverviewForUser(authContext.userId)
          return ok({ ok: true, ...res })
        }
        case 'POST /api/teams': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const b = schemas.createTeamBody.parse(body)
          const team = await teams.createPrivateTeam(authContext.userId, b.name)
          return ok({ ok: true, team })
        }
        case 'POST /api/teams/join-domain': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const b = schemas.joinDomainTeamBody.parse(body)
          const team = await teams.joinDomainTeam(authContext.userId, b.teamId, b.contextEmail)
          return ok({ ok: true, team })
        }
        case 'GET /api/teams/invitations/pending': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const invitations = await teams.listPendingInvitationsForUser(authContext.userId)
          return ok({ ok: true, invitations })
        }
        case 'GET /api/teams/overview': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const overview = await teams.listTeamsOverviewForUser(authContext.userId)
          return ok({ ok: true, ...overview })
        }
        case 'GET /api/projects': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const projectsList = await projects.listProjectsForUser(authContext.userId)
          return ok({ ok: true, projects: projectsList })
        }
        case 'POST /api/projects': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const b = schemas.createProjectBody.parse(body)
          const project = await projects.createProject(authContext.userId, b)
          return ok({ ok: true, project })
        }
        case 'GET /api/projects/invitations/pending': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const invitations = await projects.listPendingInvitationsForUser(authContext.userId)
          return ok({ ok: true, invitations })
        }
        case 'GET /api/dev/outbox': {
          const to = query.get('to') ?? undefined
          const emails = await auth.outbox.getEmails(to)
          return ok({ ok: true, emails })
        }
        case 'POST /api/dev/outbox/clear': {
          await auth.outbox.clear()
          return ok({ ok: true })
        }
        case 'POST /api/auth/agent-grants': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const b = schemas.createAgentGrantBody.parse(body)
          const grant = await auth.createAgentGrantCode(authContext.userId, b)
          return ok({ ok: true, code: grant.code, expiresAt: grant.expiresAt })
        }
        case 'POST /api/auth/agent-token': {
          const b = schemas.exchangeAgentTokenBody.parse(body)
          try {
            const res = await auth.exchangeAgentCodeForToken(b.code, b.codeVerifier)
            return ok({
              ok: true,
              token: res.token,
              tokenPrefix: res.session.tokenPrefix,
              agentName: res.session.agentName,
              projectScopes: res.session.projectScopes,
              idleTimeoutMs: res.session.idleTimeoutMs,
              absoluteExpiresAt: res.session.absoluteExpiresAt,
            })
          } catch (err) {
            return badRequest(err instanceof Error ? err.message : String(err))
          }
        }
        case 'GET /api/auth/agent-sessions': {
          if (!authContext?.userId) return unauthorized('authentication required')
          const sessions = await auth.listAgentSessionsForUser(authContext.userId)
          return ok({ ok: true, sessions })
        }
        default: {
          const parts = pathname.split('/')

          // Dynamic agent session routes
          if (pathname.startsWith('/api/auth/agent-sessions/')) {
            const sessionId = parts[4]
            if (method === 'DELETE' && sessionId) {
              if (!authContext?.userId) return unauthorized('authentication required')
              const revoked = await auth.revokeAgentSession(authContext.userId, sessionId)
              return ok({ ok: true, revoked })
            }
          }

          // Dynamic project routes
          if (pathname.startsWith('/api/projects/invitations/')) {
            const invId = parts[4]
            if (!invId) return badRequest('invitation id required')

            if (method === 'POST' && parts[5] === 'accept') {
              if (!authContext?.userId) return unauthorized('authentication required')
              const b = schemas.acceptProjectInvitationBody.parse(body ?? {})
              const res = await projects.acceptInvitation(authContext.userId, invId, b)
              return ok(res)
            }
            if (method === 'POST' && parts[5] === 'reject') {
              if (!authContext?.userId) return unauthorized('authentication required')
              const res = await projects.rejectInvitation(authContext.userId, invId)
              return ok(res)
            }
            if (method === 'DELETE' && !parts[5]) {
              if (!authContext?.userId) return unauthorized('authentication required')
              const res = await projects.revokeInvitation(authContext.userId, invId)
              return ok(res)
            }
          }

          if (pathname.startsWith('/api/projects/')) {
            const parts = pathname.split('/')
            const projectId = parts[3]
            if (!projectId) return badRequest('project id required')

            if (method === 'GET' && !parts[4]) {
              if (!authContext?.userId) return unauthorized('authentication required')
              const res = await projects.getProjectDetails(projectId, authContext.userId)
              return ok({ ok: true, project: res })
            }
            if (method === 'POST' && parts[4] === 'invite') {
              if (!authContext?.userId) return unauthorized('authentication required')
              const b = schemas.inviteProjectMemberBody.parse(body)
              const invitation = await projects.inviteToProject(authContext.userId, projectId, b)
              return ok({ ok: true, invitation })
            }
            if (method === 'POST' && parts[4] === 'teams') {
              if (!authContext?.userId) return unauthorized('authentication required')
              const b = schemas.assignProjectTeamBody.parse(body)
              const res = await projects.assignTeamToProject(authContext.userId, projectId, b.teamId, b.role ?? 'editor')
              return ok(res)
            }
            if (method === 'DELETE' && parts[4] === 'teams' && parts[5]) {
              if (!authContext?.userId) return unauthorized('authentication required')
              const teamId = parts[5]
              const res = await projects.removeTeamFromProject(authContext.userId, projectId, teamId)
              return ok(res)
            }
            if (method === 'POST' && parts[4] === 'members' && parts[5] === 'remove') {
              if (!authContext?.userId) return unauthorized('authentication required')
              const b = schemas.removeProjectMemberBody.parse(body)
              const res = await projects.removeMemberFromProject(authContext.userId, b.targetUserId, projectId, b.reverificationCode)
              return ok(res)
            }
            if (method === 'POST' && parts[4] === 'context-email') {
              if (!authContext?.userId) return unauthorized('authentication required')
              const b = schemas.updateProjectContextEmailBody.parse(body)
              const res = await projects.updateMemberContextEmail(authContext.userId, projectId, b.contextEmail)
              return ok(res)
            }
            if (method === 'POST' && parts[4] === 'leave') {
              if (!authContext?.userId) return unauthorized('authentication required')
              const res = await projects.leaveProject(authContext.userId, projectId)
              return ok(res)
            }
          }

          // Dynamic team routes
          if (pathname.startsWith('/api/teams/invitations/')) {
            const parts = pathname.split('/')
            const invId = parts[4]
            if (!invId) return badRequest('invitation id required')

            if (method === 'POST' && parts[5] === 'accept') {
              if (!authContext?.userId) return unauthorized('authentication required')
              const b = schemas.acceptTeamInvitationBody.parse(body ?? {})
              const res = await teams.acceptInvitation(authContext.userId, invId, b.contextEmail)
              return ok(res)
            }
            if (method === 'POST' && parts[5] === 'reject') {
              if (!authContext?.userId) return unauthorized('authentication required')
              const res = await teams.rejectInvitation(authContext.userId, invId)
              return ok(res)
            }
            if (method === 'DELETE' && !parts[5]) {
              if (!authContext?.userId) return unauthorized('authentication required')
              const res = await teams.revokeInvitation(authContext.userId, invId)
              return ok(res)
            }
          }

          if (pathname.startsWith('/api/teams/')) {
            const parts = pathname.split('/')
            const teamId = parts[3]
            if (!teamId) return badRequest('team id required')

            if (method === 'GET' && !parts[4]) {
              if (!authContext?.userId) return unauthorized('authentication required')
              const res = await teams.getTeamDetails(teamId, authContext.userId)
              return ok({ ok: true, team: res })
            }
            if (method === 'POST' && parts[4] === 'invite') {
              if (!authContext?.userId) return unauthorized('authentication required')
              const b = schemas.inviteTeamMemberBody.parse(body)
              const invitation = await teams.inviteToTeam(authContext.userId, teamId, { target: b.target, role: b.role })
              return ok({ ok: true, invitation })
            }
            if (method === 'POST' && parts[4] === 'leave') {
              if (!authContext?.userId) return unauthorized('authentication required')
              const res = await teams.leaveTeam(authContext.userId, teamId)
              return ok(res)
            }
            if (method === 'POST' && parts[4] === 'members' && parts[5] === 'remove') {
              if (!authContext?.userId) return unauthorized('authentication required')
              const b = schemas.removeTeamMemberBody.parse(body)
              const res = await teams.removeMemberFromPrivateTeam(authContext.userId, b.targetUserId, teamId, b.reverificationCode)
              return ok(res)
            }
            if (method === 'POST' && parts[4] === 'expel-domain') {
              if (!authContext?.userId) return unauthorized('authentication required')
              const b = schemas.expelDomainMemberBody.parse(body)
              const res = await teams.expelMemberFromDomainTeam(authContext.userId, b.targetUserId, teamId, b.reverificationCode)
              return ok(res)
            }
          }

          return { status: 404, json: { error: `no route ${key}` } }
        }
      }
    } catch (err) {
      // Invalid request body → 400 (was an unchecked cast → 500/crash before D2).
      if (err instanceof z.ZodError) return { status: 400, json: { error: 'invalid request body', issues: err.issues } }
      throw err
    }
  }

  return { handle, subscribe: bus.subscribe, auth, teams, projects }
}

async function init(repoDir: string, config: Config): Promise<{ repo: RepoBackend; store: CommentStore }> {
  let repo: RepoBackend
  if (existsSync(join(repoDir, '.git'))) {
    repo = new LocalGitBackend(repoDir)
  } else {
    const backend = await LocalGitBackend.init(repoDir, SYSTEM)
    await backend.writeFiles('main', Object.entries(SAMPLE).map(([path, content]) => ({ path, content })), 'seed: sample docs', SYSTEM)
    // One comment-sidecar branch per user (D17 model A); edit branches are created lazily on lock acquire.
    for (const user of Object.keys(config.users)) await backend.createBranch(commentsBranch(user), 'main')
    repo = backend
  }
  return { repo, store: new CommentStore(repo) }
}

/** Ephemeral per-file edit-scratch branch — autosave target + live-watch source (D20). */
const editBranch = (path: string): string => `edit/${path}`
/** A user's comment-sidecar branch (D17 model A); decoupled from editing in D20. */
const commentsBranch = (user: string): string => `comments/${user}`
const ok = (json: unknown): ApiResponse => ({ status: 200, json })
const badRequest = (error: string, extra?: Record<string, unknown>): ApiResponse => ({ status: 400, json: { error, ...extra } })
const unauthorized = (error: string): ApiResponse => ({ status: 401, json: { error } })
const forbidden = (error: string): ApiResponse => ({ status: 403, json: { error } })
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isDocFile = (f: string): boolean => f.endsWith('.md') && !f.startsWith('.md4lp/')
