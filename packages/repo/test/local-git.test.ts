import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalGitBackend, type Author } from '../src/index'

const author: Author = { name: 'Test', email: 't@example.com' }
const tmpRepo = () => mkdtempSync(join(tmpdir(), 'md4lp-repo-'))

describe('LocalGitBackend', () => {
  it('branch, write+commit, read, diff (added), merge into main', async () => {
    const repo = await LocalGitBackend.init(tmpRepo(), author)
    expect(await repo.currentBranch()).toBe('main')

    await repo.createBranch('feature', 'main')
    const oid = await repo.writeFiles('feature', [{ path: 'doc.md', content: '# Hi\n' }], 'add doc', author)
    expect(oid).toMatch(/^[0-9a-f]{40}$/)

    expect(await repo.readFile('feature', 'doc.md')).toBe('# Hi\n')
    await expect(repo.readFile('main', 'doc.md')).rejects.toThrow() // not on main yet

    expect(await repo.diff('main', 'feature')).toContainEqual({ path: 'doc.md', status: 'added' })

    const merge = await repo.merge('feature', 'main', author)
    expect(merge.oid).toMatch(/^[0-9a-f]{40}$/)
    expect(await repo.readFile('main', 'doc.md')).toBe('# Hi\n')

    expect(await repo.listBranches()).toEqual(expect.arrayContaining(['main', 'feature']))
    expect(await repo.listFiles('main')).toContain('doc.md')
    expect((await repo.log('main')).length).toBeGreaterThanOrEqual(2)
  })

  it('diff reports modified', async () => {
    const repo = await LocalGitBackend.init(tmpRepo(), author)
    await repo.writeFiles('main', [{ path: 'a.md', content: 'one\n' }], 'add a', author)
    await repo.createBranch('edit', 'main')
    await repo.writeFiles('edit', [{ path: 'a.md', content: 'two\n' }], 'change a', author)
    expect(await repo.diff('main', 'edit')).toContainEqual({ path: 'a.md', status: 'modified' })
  })

  it('diff reports removed (file present in a, absent in b)', async () => {
    const repo = await LocalGitBackend.init(tmpRepo(), author)
    await repo.createBranch('feature', 'main')
    await repo.writeFiles('feature', [{ path: 'only-on-feature.md', content: 'x\n' }], 'add', author)
    // a=feature has the file, b=main does not → from a's perspective it is removed in b.
    expect(await repo.diff('feature', 'main')).toContainEqual({ path: 'only-on-feature.md', status: 'removed' })
  })

  it('merge reports alreadyMerged when both refs point at the same commit', async () => {
    const repo = await LocalGitBackend.init(tmpRepo(), author)
    await repo.createBranch('feature', 'main')
    const result = await repo.merge('feature', 'main', author)
    expect(result).toEqual({ oid: expect.stringMatching(/^[0-9a-f]{40}$/), alreadyMerged: true, fastForward: false })
  })

  it('merge falls back to a real merge when branches diverged (non-fast-forward)', async () => {
    const repo = await LocalGitBackend.init(tmpRepo(), author)
    await repo.writeFiles('main', [{ path: 'base.md', content: 'base\n' }], 'base', author)
    await repo.createBranch('feature', 'main')
    await repo.writeFiles('feature', [{ path: 'feature.md', content: 'f\n' }], 'feature work', author)
    await repo.writeFiles('main', [{ path: 'main.md', content: 'm\n' }], 'main work', author) // main diverges

    const result = await repo.merge('feature', 'main', author)
    expect(result.oid).toMatch(/^[0-9a-f]{40}$/)
    expect(result.fastForward).toBe(false)
    // both sides of the divergence land on main
    expect(await repo.readFile('main', 'feature.md')).toBe('f\n')
    expect(await repo.readFile('main', 'main.md')).toBe('m\n')
  })

  it('writeFiles handles nested paths and updates an existing nested file', async () => {
    const repo = await LocalGitBackend.init(tmpRepo(), author)
    await repo.writeFiles('main', [{ path: 'docs/guide/intro.md', content: 'v1\n' }], 'add nested', author)
    expect(await repo.readFile('main', 'docs/guide/intro.md')).toBe('v1\n')
    await repo.writeFiles('main', [{ path: 'docs/guide/intro.md', content: 'v2\n' }], 'update nested', author)
    expect(await repo.readFile('main', 'docs/guide/intro.md')).toBe('v2\n')
    expect(await repo.listFiles('main')).toContain('docs/guide/intro.md')
  })

  it('createBranch without `from` branches off the current HEAD', async () => {
    const repo = await LocalGitBackend.init(tmpRepo(), author)
    await repo.writeFiles('main', [{ path: 'a.md', content: 'a\n' }], 'add a', author)
    await repo.createBranch('side') // no `from` → uses current branch (main)
    expect(await repo.listBranches()).toContain('side')
    expect(await repo.readFile('side', 'a.md')).toBe('a\n')
  })

  it('readFile accepts a commit oid directly, not only a branch name', async () => {
    const repo = await LocalGitBackend.init(tmpRepo(), author)
    const oid = await repo.writeFiles('main', [{ path: 'a.md', content: 'pinned\n' }], 'add a', author)
    expect(await repo.readFile(oid, 'a.md')).toBe('pinned\n')
  })

  it('writeFiles rejects an empty change set instead of committing a null tree (R3)', async () => {
    const repo = await LocalGitBackend.init(tmpRepo(), author)
    await expect(repo.writeFiles('main', [], 'noop', author)).rejects.toThrow(/at least one change/)
  })

  it('head resolves a branch to its oid and returns null for a missing ref', async () => {
    const repo = await LocalGitBackend.init(tmpRepo(), author)
    const oid = await repo.head('main')
    expect(oid).toMatch(/^[0-9a-f]{40}$/)
    expect(await repo.head('does-not-exist')).toBeNull()
  })

  it('resetBranch force-points a branch at another ref (creating it if absent)', async () => {
    const repo = await LocalGitBackend.init(tmpRepo(), author)
    await repo.writeFiles('main', [{ path: 'a.md', content: 'v1\n' }], 'v1', author)
    const mainOid = await repo.head('main')

    // Create edit/a.md pointed at main, then advance it; resetBranch must snap it back to main.
    await repo.resetBranch('edit/a.md', 'main') // creates the branch (did not exist)
    expect(await repo.head('edit/a.md')).toBe(mainOid)
    await repo.writeFiles('edit/a.md', [{ path: 'a.md', content: 'v2\n' }], 'v2', author)
    expect(await repo.head('edit/a.md')).not.toBe(mainOid)

    await repo.resetBranch('edit/a.md', 'main')
    expect(await repo.head('edit/a.md')).toBe(mainOid)
    expect(await repo.readFile('edit/a.md', 'a.md')).toBe('v1\n')
  })

  // Red de seguridad para D1 (extraer el mutex): sin la cola single-lane, escrituras concurrentes a la
  // misma rama parten del mismo commit padre y se pisan en el ref → algunos ficheros se pierden.
  it('serializes concurrent writeFiles — no lost writes (D18)', async () => {
    const repo = await LocalGitBackend.init(tmpRepo(), author)
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => repo.writeFiles('main', [{ path: `f${i}.md`, content: `${i}\n` }], `add f${i}`, author)),
    )
    const files = await repo.listFiles('main')
    for (let i = 0; i < 8; i++) expect(files).toContain(`f${i}.md`)
  })
})
