import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalGitBackend, type Author, type RepoBackend } from '@md4lp/repo'
import { createAnchor } from '@md4lp/anchor'
import { CommentStore } from '../src/index'

const author: Author = { name: 'alice', email: 'a@example.com' }
const bob: Author = { name: 'bob', email: 'b@example.com' }
const tmpRepo = () => mkdtempSync(join(tmpdir(), 'md4lp-cmt-'))

function deterministicStore(repo: RepoBackend): CommentStore {
  let n = 0
  return new CommentStore(repo, { id: () => `id${++n}`, now: () => '2026-06-08T00:00:00Z' })
}

async function seedWithBranch() {
  const repo = await LocalGitBackend.init(tmpRepo(), author)
  await repo.writeFiles('main', [{ path: 'doc.md', content: 'The brown fox jumps.\n' }], 'add doc', author)
  await repo.createBranch('wip/alice', 'main')
  const commit = (await repo.log('wip/alice', 1))[0]!.oid
  return { repo, commit }
}

describe('CommentStore (model A: thread in creator branch, nested replies)', () => {
  it('stores a comment in the creator sidecar and lists it', async () => {
    const { repo, commit } = await seedWithBranch()
    const cs = deterministicStore(repo)
    const start = 'The brown fox jumps.\n'.indexOf('fox')
    const anchor = createAnchor('The brown fox jumps.\n', start, start + 3)
    const c = await cs.add('wip/alice', 'doc.md', 'alice', author, { anchor, commit, body: 'why brown?' })
    expect(c.id).toBe('id1')

    const raw = await repo.readFile('wip/alice', '.md4lp/doc.md.alice.comments.yaml')
    expect(raw).toContain('why brown?')
    const list = await cs.list('wip/alice', 'doc.md', 'alice')
    expect(list).toHaveLength(1)
    expect(list[0]!.anchor.quote).toBe('fox')
  })

  it('supports nested replies (multiple conversation lines)', async () => {
    const { repo, commit } = await seedWithBranch()
    const cs = deterministicStore(repo)
    const anchor = createAnchor('The brown fox jumps.\n', 0, 3)
    const c = await cs.add('wip/alice', 'doc.md', 'alice', author, { anchor, commit, body: 'top' })
    const r1 = await cs.addReply('wip/alice', 'doc.md', 'alice', c.id, bob, 'a reply from bob')
    await cs.addReply('wip/alice', 'doc.md', 'alice', r1.id, author, 'alice replies to bob') // nested
    await cs.addReply('wip/alice', 'doc.md', 'alice', c.id, author, 'a second conversation line') // sibling line

    const [comment] = await cs.list('wip/alice', 'doc.md', 'alice')
    expect(comment!.replies).toHaveLength(2) // two top-level conversation lines
    expect(comment!.replies[0]!.body).toBe('a reply from bob')
    expect(comment!.replies[0]!.replies[0]!.body).toBe('alice replies to bob') // nested deeper
    expect(comment!.replies[1]!.body).toBe('a second conversation line')
  })

  it('edits own childless message; blocks non-author and edits-after-reply', async () => {
    const { repo, commit } = await seedWithBranch()
    const cs = deterministicStore(repo)
    const c = await cs.add('wip/alice', 'doc.md', 'alice', author, { anchor: createAnchor('The brown fox jumps.\n', 0, 3), commit, body: 'orig' })
    expect(await cs.editBody('wip/alice', 'doc.md', 'alice', c.id, bob, 'hack')).toBe('forbidden')
    expect(await cs.editBody('wip/alice', 'doc.md', 'alice', c.id, author, 'edited')).toBe('ok')
    expect((await cs.list('wip/alice', 'doc.md', 'alice'))[0]!.body).toBe('edited')
    await cs.addReply('wip/alice', 'doc.md', 'alice', c.id, bob, 'a reply')
    expect(await cs.editBody('wip/alice', 'doc.md', 'alice', c.id, author, 'again')).toBe('conflict')
  })

  it('stores a suggestion and resolves status', async () => {
    const { repo, commit } = await seedWithBranch()
    const cs = deterministicStore(repo)
    const anchor = createAnchor('The brown fox jumps.\n', 0, 3)
    const c = await cs.add('wip/alice', 'doc.md', 'alice', author, { anchor, commit, body: '', suggestion: 'A' })
    expect(c.suggestion).toBe('A')
    await cs.setStatus('wip/alice', 'doc.md', 'alice', author, c.id, 'resolved')
    const [stored] = await cs.list('wip/alice', 'doc.md', 'alice')
    expect(stored!.status).toBe('resolved')
  })

  it('list returns [] for a file with no sidecar', async () => {
    const { repo } = await seedWithBranch()
    const cs = deterministicStore(repo)
    expect(await cs.list('wip/alice', 'never-commented.md', 'alice')).toEqual([])
  })

  it('toggles a reaction on/off and tracks distinct reactors', async () => {
    const { repo, commit } = await seedWithBranch()
    const cs = deterministicStore(repo)
    const c = await cs.add('wip/alice', 'doc.md', 'alice', author, { anchor: createAnchor('The brown fox jumps.\n', 0, 3), commit, body: 'hi' })

    await cs.toggleReaction('wip/alice', 'doc.md', 'alice', c.id, author, '👍')
    await cs.toggleReaction('wip/alice', 'doc.md', 'alice', c.id, bob, '👍')
    expect((await cs.list('wip/alice', 'doc.md', 'alice'))[0]!.reactions?.['👍']).toEqual(['alice', 'bob'])

    // alice toggles the same emoji off → removed from the list, bob remains
    await cs.toggleReaction('wip/alice', 'doc.md', 'alice', c.id, author, '👍')
    expect((await cs.list('wip/alice', 'doc.md', 'alice'))[0]!.reactions?.['👍']).toEqual(['bob'])

    // last reactor toggles off → the emoji key is dropped entirely
    await cs.toggleReaction('wip/alice', 'doc.md', 'alice', c.id, bob, '👍')
    expect((await cs.list('wip/alice', 'doc.md', 'alice'))[0]!.reactions?.['👍']).toBeUndefined()
  })

  it('reports missing target nodes (throw for reply/status/react, notfound for edit)', async () => {
    const { repo } = await seedWithBranch()
    const cs = deterministicStore(repo)
    await expect(cs.addReply('wip/alice', 'doc.md', 'alice', 'nope', bob, 'x')).rejects.toThrow()
    await expect(cs.setStatus('wip/alice', 'doc.md', 'alice', author, 'nope', 'resolved')).rejects.toThrow()
    await expect(cs.toggleReaction('wip/alice', 'doc.md', 'alice', 'nope', author, '👍')).rejects.toThrow()
    expect(await cs.editBody('wip/alice', 'doc.md', 'alice', 'nope', author, 'x')).toBe('notfound')
  })

  it('rejects a sidecar written with an unsupported version (R4)', async () => {
    const { repo } = await seedWithBranch()
    const cs = deterministicStore(repo)
    // write a sidecar with a future schema version directly into the creator branch
    await repo.writeFiles('wip/alice', [{ path: cs.sidecarPath('doc.md', 'alice'), content: 'version: 99\ncomments: []\n' }], 'corrupt sidecar', author)
    await expect(cs.list('wip/alice', 'doc.md', 'alice')).rejects.toThrow(/version 99/)
  })

  // Red de seguridad para D1 (extraer el mutex a un paquete compartido): sin la cola single-lane,
  // dos `add` concurrentes leen el mismo estado y el segundo pisa al primero (lost update).
  it('serializes concurrent adds — no lost updates (D18)', async () => {
    const { repo, commit } = await seedWithBranch()
    const cs = deterministicStore(repo)
    const anchor = createAnchor('The brown fox jumps.\n', 0, 3)
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => cs.add('wip/alice', 'doc.md', 'alice', author, { anchor, commit, body: `c${i}` })),
    )
    expect(await cs.list('wip/alice', 'doc.md', 'alice')).toHaveLength(8)
  })
})
