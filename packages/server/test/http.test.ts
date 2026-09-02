import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { createApi } from '../src/api'
import { createHttpApp } from '../src/http'
import { DEFAULT_CONFIG } from '../src/config'

// Build a fresh app over a throwaway seeded repo. createApi seeds welcome.md/scope.md + comments/<user>
// branches on first use, so each test dir is a self-contained workspace. Pass config overrides (e.g. a
// short lockTimeoutMs) to exercise the edit-lock paths.
const freshApp = (overrides: Partial<typeof DEFAULT_CONFIG> = {}) =>
  createHttpApp(createApi(mkdtempSync(join(tmpdir(), 'md4lp-server-')), { ...DEFAULT_CONFIG, ...overrides }))

const json = (res: Response) => res.json() as Promise<any>

describe('@md4lp/server HTTP', () => {
  it('GET /api/state lists the seeded docs', async () => {
    const app = freshApp()
    const res = await app.request('/api/state?user=alice')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.role).toBe('editor')
    expect(body.files).toEqual(expect.arrayContaining(['welcome.md', 'scope.md']))
  })

  it('editor (alice) must hold the lock to write; release consolidates to main (D20)', async () => {
    const app = freshApp()
    const read = await app.request('/api/file?user=alice&path=welcome.md')
    expect(read.status).toBe(200)
    expect((await json(read)).content).toContain('# Welcome')

    const put = () =>
      app.request('/api/file?user=alice&path=welcome.md', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '# Welcome edited\n', message: 'edit' }),
      })

    // No lock held → write is rejected (409).
    expect((await put()).status).toBe(409)

    // Acquire → write lands on the edit branch → release consolidates it to main.
    expect((await post(app, '/api/lock/acquire?user=alice&path=welcome.md', {})).status).toBe(200)
    expect((await put()).status).toBe(200)
    expect((await post(app, '/api/lock/release?user=alice&path=welcome.md', {})).status).toBe(200)

    const onMain = await json(await app.request('/api/file?user=alice&path=welcome.md&branch=main'))
    expect(onMain.content).toContain('# Welcome edited')
  })

  it('commenter (bob) cannot write a .md file → 403', async () => {
    const app = freshApp()
    const res = await app.request('/api/file?user=bob&path=welcome.md', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'nope', message: 'x' }),
    })
    expect(res.status).toBe(403)
  })

  it('commenter (bob) cannot acquire the edit lock → 403', async () => {
    const app = freshApp()
    const res = await app.request('/api/lock/acquire?user=bob&path=welcome.md', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(403)
  })

  it('a commenter can create a comment (happy path)', async () => {
    const app = freshApp()
    const res = await app.request('/api/comment?user=bob&path=welcome.md', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start: 0, end: 5, body: 'first comment' }),
    })
    expect(res.status).toBe(200)
    expect((await json(res)).comment.body).toBe('first comment')
  })

  // ---- thread + suggestion + merge flows (red de seguridad para D2: route table + zod) ----

  const post = (app: Hono, path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  it('the editor sees a commenter thread and can reply, react, and resolve it', async () => {
    const app = freshApp()
    const made = await json(await post(app, '/api/comment?user=bob&path=welcome.md', { start: 0, end: 5, body: 'q' }))
    const id = made.comment.id

    // editor (alice) aggregates bob's thread cross-user
    const listed = await json(await app.request('/api/comments?user=alice&path=welcome.md'))
    expect(listed.comments.some((c: any) => c.comment.id === id && c.owner === 'bob')).toBe(true)

    expect((await post(app, '/api/reply?user=alice&path=welcome.md', { parentId: id, owner: 'bob', body: 'answer' })).status).toBe(200)
    expect((await post(app, '/api/react?user=alice&path=welcome.md', { nodeId: id, owner: 'bob', emoji: '👍' })).status).toBe(200)

    const after = await json(await app.request('/api/comments?user=alice&path=welcome.md'))
    const thread = after.comments.find((c: any) => c.comment.id === id)
    expect(thread.comment.replies).toHaveLength(1)
    expect(thread.comment.reactions['👍']).toContain('alice')
  })

  it('edit is author-only (403) and blocked after a reply lands (409)', async () => {
    const app = freshApp()
    const id = (await json(await post(app, '/api/comment?user=bob&path=welcome.md', { start: 0, end: 5, body: 'orig' }))).comment.id

    // alice is not the author of bob's comment
    expect((await post(app, '/api/edit?user=alice&path=welcome.md', { nodeId: id, owner: 'bob', body: 'hack' })).status).toBe(403)
    // author can edit while childless
    expect((await post(app, '/api/edit?user=bob&path=welcome.md', { nodeId: id, owner: 'bob', body: 'edited' })).status).toBe(200)
    // once replied, edit conflicts
    await post(app, '/api/reply?user=alice&path=welcome.md', { parentId: id, owner: 'bob', body: 'r' })
    expect((await post(app, '/api/edit?user=bob&path=welcome.md', { nodeId: id, owner: 'bob', body: 'again' })).status).toBe(409)
  })

  it('an editor applies a suggestion → file content changes and the comment resolves', async () => {
    const app = freshApp()
    const { content } = await json(await app.request('/api/file?user=alice&path=welcome.md'))
    const start = content.indexOf('pleasant')
    expect(start).toBeGreaterThan(-1)
    const id = (await json(await post(app, '/api/comment?user=bob&path=welcome.md', { start, end: start + 'pleasant'.length, body: 'stronger word', suggestion: 'delightful' }))).comment.id

    const applied = await post(app, '/api/suggestion/apply?user=alice&path=welcome.md', { commentId: id, owner: 'bob' })
    expect(applied.status).toBe(200)
    const after = await json(await app.request('/api/file?user=alice&path=welcome.md'))
    expect(after.content).toContain('delightful')
    expect(after.content).not.toContain('pleasant')
  })

  it('a commenter cannot apply a suggestion → 403', async () => {
    const app = freshApp()
    const id = (await json(await post(app, '/api/comment?user=bob&path=welcome.md', { start: 0, end: 5, body: '', suggestion: 'X' }))).comment.id
    expect((await post(app, '/api/suggestion/apply?user=bob&path=welcome.md', { commentId: id, owner: 'bob' })).status).toBe(403)
  })

  it('an idle editor is taken over: the next editor consolidates the prior work and gains the lock (D20)', async () => {
    const app = freshApp({ lockTimeoutMs: 1 }) // expire near-instantly so the takeover path is exercised
    // alice acquires and auto-saves, then goes idle
    expect((await post(app, '/api/lock/acquire?user=alice&path=welcome.md', {})).status).toBe(200)
    await app.request('/api/file?user=alice&path=welcome.md', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '# Alice idle work\n', message: 'edit' }),
    })
    await new Promise((r) => setTimeout(r, 5)) // > lockTimeoutMs → alice's lock is now expired

    // agent-claude (also an editor) takes over → alice's work is consolidated to main first
    const taken = await post(app, '/api/lock/acquire?user=agent-claude&path=welcome.md', {})
    expect(taken.status).toBe(200)
    const onMain = await json(await app.request('/api/file?user=alice&path=welcome.md&branch=main'))
    expect(onMain.content).toContain('# Alice idle work')

    // alice's heartbeat now fails (she was bumped)
    expect((await post(app, '/api/lock/heartbeat?user=alice&path=welcome.md', {})).status).toBe(409)
  })

  it('a second editor is blocked while the first holds a fresh lock → 409', async () => {
    const app = freshApp() // default 30s timeout → no expiry within the test
    expect((await post(app, '/api/lock/acquire?user=alice&path=welcome.md', {})).status).toBe(200)
    const blocked = await post(app, '/api/lock/acquire?user=agent-claude&path=welcome.md', {})
    expect(blocked.status).toBe(409)
    expect((await json(blocked)).editor).toBe('alice')
  })

  it('does not leak stack traces on an internal error (R6)', async () => {
    const app = freshApp()
    // reply to a non-existent parent → CommentStore throws → surfaces as a 500
    const res = await post(app, '/api/reply?user=alice&path=welcome.md', { parentId: 'does-not-exist', owner: 'alice', body: 'x' })
    expect(res.status).toBe(500)
    const body = await json(res)
    expect(body.error).toContain('not found')
    expect(body.error).not.toMatch(/\n\s+at /) // no stack frames in the client-facing message
  })

  it('rejects a malformed request body with 400, not a 500/crash (D2)', async () => {
    const app = freshApp()
    // POST /api/comment requires numeric start/end; this body omits them
    const res = await post(app, '/api/comment?user=bob&path=welcome.md', { body: 'no offsets here' })
    expect(res.status).toBe(400)
    expect((await json(res)).error).toMatch(/invalid request body/)
  })

  // ---- live events (D20: SSE backing) ----

  it('subscribe receives an event per mutation and stops after unsubscribe (bus contract)', async () => {
    const api = createApi(mkdtempSync(join(tmpdir(), 'md4lp-bus-')), DEFAULT_CONFIG)
    const events: Array<{ type: string; file: string; by: string }> = []
    const unsub = api.subscribe((e) => events.push(e))
    const params = new URLSearchParams({ path: 'welcome.md' })
    await api.handle('POST', '/api/comment', params, { start: 0, end: 5, body: 'hi' }, 'bob')
    expect(events).toContainEqual({ type: 'comments', file: 'welcome.md', by: 'bob' }) // stamped with the actor
    unsub()
    await api.handle('POST', '/api/comment', params, { start: 0, end: 5, body: 'hi again' }, 'bob')
    expect(events).toHaveLength(1) // no further events after unsubscribe
  })

  it('GET /api/events streams text/event-stream and pushes a data event on a mutation', async () => {
    const api = createApi(mkdtempSync(join(tmpdir(), 'md4lp-sse-')), DEFAULT_CONFIG)
    const app = createHttpApp(api)
    const res = await app.request('/api/events?user=alice')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    expect(dec.decode((await reader.read()).value)).toContain('connected') // opening comment line

    await api.handle('POST', '/api/comment', new URLSearchParams({ path: 'welcome.md' }), { start: 0, end: 5, body: 'x' }, 'bob')
    expect(dec.decode((await reader.read()).value)).toContain('"type":"comments"')
    await reader.cancel()
  })

  // ---- Auth & Multi-Email HTTP Endpoints ----

  describe('Auth & Multi-Email HTTP Endpoints', () => {
    it('full flow: request code → verify code → get session → manage emails → logout', async () => {
      const api = createApi(mkdtempSync(join(tmpdir(), 'md4lp-auth-')), DEFAULT_CONFIG)
      const app = createHttpApp(api)

      // 1. Request verification code
      const reqRes = await post(app, '/api/auth/request-code', { email: 'helen@example.com', purpose: 'login', name: 'Helen' })
      expect(reqRes.status).toBe(200)

      // 2. Read code from dev outbox
      const outboxRes = await app.request('/api/dev/outbox?to=helen@example.com')
      expect(outboxRes.status).toBe(200)
      const outboxData = await json(outboxRes)
      expect(outboxData.emails).toHaveLength(1)
      const code = outboxData.emails[0].code
      expect(code).toBeDefined()

      // 3. Verify code and obtain session token
      const verifyRes = await post(app, '/api/auth/verify-code', { email: 'helen@example.com', purpose: 'login', code })
      expect(verifyRes.status).toBe(200)
      const verifyData = await json(verifyRes)
      expect(verifyData.ok).toBe(true)
      expect(verifyData.token).toBeDefined()
      expect(verifyData.user.name).toBe('Helen')
      expect(verifyData.user.defaultEmail).toBe('helen@example.com')

      const token = verifyData.token

      // 4. GET /api/auth/me with Bearer token
      const meRes = await app.request('/api/auth/me', {
        headers: { authorization: `Bearer ${token}` },
      })
      expect(meRes.status).toBe(200)
      const meData = await json(meRes)
      expect(meData.user.id).toBe(verifyData.user.id)
      expect(meData.user.emails).toHaveLength(1)

      // 5. Request adding secondary email
      const addReqRes = await app.request('/api/auth/emails/request-add', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: 'helen.work@corp.com' }),
      })
      expect(addReqRes.status).toBe(200)

      const secCode = (await api.auth.outbox.getLatestCode('helen.work@corp.com', 'add_email'))!
      expect(secCode).toBeDefined()

      // 6. Verify secondary email
      const addVerifyRes = await app.request('/api/auth/emails/verify-add', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: 'helen.work@corp.com', code: secCode }),
      })
      expect(addVerifyRes.status).toBe(200)
      const addVerifyData = await json(addVerifyRes)
      expect(addVerifyData.user.emails).toHaveLength(2)

      // 7. Change primary email
      const setPrimaryRes = await app.request('/api/auth/emails/primary', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: 'helen.work@corp.com' }),
      })
      expect(setPrimaryRes.status).toBe(200)

      // 8. Delete previous primary email (now secondary)
      const delEmailRes = await app.request('/api/auth/emails', {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: 'helen@example.com' }),
      })
      expect(delEmailRes.status).toBe(200)

      // 9. Logout
      const logoutRes = await app.request('/api/auth/logout', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(logoutRes.status).toBe(200)

      // 10. GET /api/auth/me after logout should return 401
      const meAfterLogout = await app.request('/api/auth/me', {
        headers: { authorization: `Bearer ${token}` },
      })
      expect(meAfterLogout.status).toBe(401)
    })

    it('manages agent sessions via REST API: grants, PKCE token exchange, listing, and revocation', async () => {
      const { createHash } = await import('node:crypto')
      const app = freshApp()

      // 1. User registers & logs in
      await app.request('/api/auth/request-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: 'dave@engineer.io', purpose: 'login', name: 'Dave' }),
      })
      const outboxRes = await app.request('/api/dev/outbox?to=dave@engineer.io')
      const code = (await json(outboxRes)).emails[0].code
      const loginRes = await app.request('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: 'dave@engineer.io', code }),
      })
      const userToken = (await json(loginRes)).token

      // 2. Client initiates PKCE
      const codeVerifier = 'client_super_secret_pkce_verifier_9876543210'
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

      // 3. Create agent grant code
      const grantRes = await app.request('/api/auth/agent-grants', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${userToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agentName: 'Cursor IDE',
          description: 'MacBook Pro AI editor',
          codeChallenge,
          projectScopes: [{ projectId: 'project-xyz', maxRole: 'editor' }],
        }),
      })
      expect(grantRes.status).toBe(200)
      const grantBody = await json(grantRes)
      expect(grantBody.ok).toBe(true)
      expect(grantBody.code).toBeDefined()

      // 4. Exchange code for agent token
      const tokenRes = await app.request('/api/auth/agent-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: grantBody.code,
          codeVerifier,
        }),
      })
      expect(tokenRes.status).toBe(200)
      const tokenBody = await json(tokenRes)
      expect(tokenBody.ok).toBe(true)
      expect(tokenBody.token).toMatch(/^md4lp_agt_/)
      expect(tokenBody.agentName).toBe('Cursor IDE')
      const agentToken = tokenBody.token

      // 5. User lists agent sessions
      const listSessionsRes = await app.request('/api/auth/agent-sessions', {
        headers: { authorization: `Bearer ${userToken}` },
      })
      expect(listSessionsRes.status).toBe(200)
      const listBody = await json(listSessionsRes)
      expect(listBody.sessions).toHaveLength(1)
      expect(listBody.sessions[0].agentName).toBe('Cursor IDE')
      const sessionId = listBody.sessions[0].id

      // 6. Agent accesses API using Bearer md4lp_agt_...
      const agentApiRes = await app.request('/api/projects', {
        headers: { authorization: `Bearer ${agentToken}` },
      })
      expect(agentApiRes.status).toBe(200)

      // 7. Revoke session
      const revokeRes = await app.request(`/api/auth/agent-sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${userToken}` },
      })
      expect(revokeRes.status).toBe(200)

      // 8. Access with revoked agent token fails (401)
      const afterRevokeRes = await app.request('/api/projects', {
        headers: { authorization: `Bearer ${agentToken}` },
      })
      expect(afterRevokeRes.status).toBe(401)
    })
  })
})

