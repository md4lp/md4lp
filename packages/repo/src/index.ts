import fs from 'node:fs'
import git from 'isomorphic-git'
import { AsyncQueue } from '@md4lp/async-queue'

/**
 * @md4lp/repo — the repository backend seam (D2).
 *
 * `RepoBackend` is the interface md4lp talks to; `LocalGitBackend` implements it over a local git
 * working directory using isomorphic-git. A future `RemoteGitBackend` (BYO repos) is a sibling
 * implementation, so nothing above this interface needs to know whether a repo is local or remote.
 *
 * A md4lp workspace may be a set of repos (D9); this backend models one repo.
 */

export interface Author {
  name: string
  email: string
}

export interface FileChange {
  /** Repo-relative POSIX path. */
  path: string
  content: string
}

export interface CommitInfo {
  oid: string
  message: string
  author: string
  timestamp: number
}

export type DiffStatus = 'added' | 'removed' | 'modified'
export interface DiffEntry {
  path: string
  status: DiffStatus
}

export interface MergeResult {
  oid: string
  alreadyMerged: boolean
  fastForward: boolean
}

export interface RepoBackend {
  listBranches(): Promise<string[]>
  currentBranch(): Promise<string | undefined>
  createBranch(name: string, from?: string): Promise<void>
  /** Force-point `name` at the commit `toRef` resolves to (a branch name or oid). Creates it if absent. */
  resetBranch(name: string, toRef: string): Promise<void>
  /** Resolve a branch/ref to its commit oid, or null if the ref does not exist (existence check). */
  head(ref: string): Promise<string | null>
  listFiles(branch: string): Promise<string[]>
  readFile(branch: string, path: string): Promise<string>
  writeFiles(branch: string, changes: FileChange[], message: string, author: Author): Promise<string>
  diff(a: string, b: string): Promise<DiffEntry[]>
  merge(from: string, into: string, author: Author): Promise<MergeResult>
  log(branch: string, depth?: number): Promise<CommitInfo[]>
}

const decoder = new TextDecoder()

/** A RepoBackend over a local git working directory. */
export class LocalGitBackend implements RepoBackend {
  private readonly dir: string
  // Object-store cache for read-heavy operations (readBlob, listFiles, walk, log).
  private readonly cache: Record<string, unknown> = {}
  // Serialize all repo operations within this process (D18 single-writer).
  private readonly lock = new AsyncQueue()

  constructor(dir: string) {
    this.dir = dir
  }

  /** Initialize a fresh repo with an initial commit so branches can be created. */
  static async init(dir: string, author: Author, defaultBranch = 'main'): Promise<LocalGitBackend> {
    fs.mkdirSync(dir, { recursive: true })
    await git.init({ fs, dir, defaultBranch })
    const backend = new LocalGitBackend(dir)
    await backend.writeFiles(defaultBranch, [{ path: '.md4lp/.keep', content: '' }], 'chore: initialize md4lp workspace', author)
    return backend
  }

  listBranches(): Promise<string[]> {
    return this.lock.run(() => git.listBranches({ fs, dir: this.dir }))
  }

  currentBranch(): Promise<string | undefined> {
    return this.lock.run(() => git.currentBranch({ fs, dir: this.dir, fullname: false }).then((b) => b ?? undefined))
  }

  createBranch(name: string, from?: string): Promise<void> {
    return this.lock.run(async () => {
      if (from) {
        // Plumbing: resolve the source ref and write the new ref directly — no checkout needed.
        const fromOid = await git.resolveRef({ fs, dir: this.dir, ref: from })
        await git.writeRef({ fs, dir: this.dir, ref: `refs/heads/${name}`, value: fromOid })
      } else {
        await git.branch({ fs, dir: this.dir, ref: name, checkout: false })
      }
    })
  }

  resetBranch(name: string, toRef: string): Promise<void> {
    return this.lock.run(async () => {
      const oid = await this.resolveOid(toRef)
      await git.writeRef({ fs, dir: this.dir, ref: `refs/heads/${name}`, value: oid, force: true })
    })
  }

  head(ref: string): Promise<string | null> {
    return this.lock.run(async () => {
      try {
        return await git.resolveRef({ fs, dir: this.dir, ref })
      } catch {
        return null
      }
    })
  }

  listFiles(branch: string): Promise<string[]> {
    return this.lock.run(() => git.listFiles({ fs, dir: this.dir, cache: this.cache, ref: branch }))
  }

  /** Read a file at a ref. `ref` may be a branch name OR a commit oid (readBlob peels commits). */
  readFile(ref: string, path: string): Promise<string> {
    return this.lock.run(async () => {
      const oid = await this.resolveOid(ref)
      const { blob } = await git.readBlob({ fs, dir: this.dir, cache: this.cache, oid, filepath: path })
      return decoder.decode(blob)
    })
  }

  // Not wrapped in run(): only called from within an already-queued operation (readFile).
  private async resolveOid(ref: string): Promise<string> {
    try {
      return await git.resolveRef({ fs, dir: this.dir, ref })
    } catch {
      return ref // already an oid
    }
  }

  /**
   * Commit `changes` to `branch` using plumbing only (writeBlob → writeTree → writeCommit →
   * writeRef). Never touches the working tree or `.git/index`, which eliminates the
   * "Invalid checksum in GitIndex buffer" corruption that occurs when concurrent requests
   * checkout different branches in isomorphic-git.
   */
  writeFiles(branch: string, changes: FileChange[], message: string, author: Author): Promise<string> {
    // Reject (not throw) so a caller that doesn't await immediately still observes the error, and the
    // method keeps a consistent "always returns a Promise" contract.
    if (changes.length === 0) return Promise.reject(new Error('writeFiles requires at least one change'))
    return this.lock.run(async () => {
      let parentOid: string | null = null
      let rootTreeOid: string | null = null
      try {
        parentOid = await git.resolveRef({ fs, dir: this.dir, ref: branch })
        const { commit } = await git.readCommit({ fs, dir: this.dir, oid: parentOid })
        rootTreeOid = commit.tree
      } catch {
        // First commit or branch does not exist yet — start from an empty tree.
      }

      for (const change of changes) {
        const blobOid = await git.writeBlob({ fs, dir: this.dir, blob: Buffer.from(change.content) })
        rootTreeOid = await upsertFileInTree(this.dir, rootTreeOid, change.path.split('/'), blobOid)
      }

      const timestamp = Math.floor(Date.now() / 1000)
      const commitOid = await git.writeCommit({
        fs,
        dir: this.dir,
        commit: {
          // Non-null: the early guard ensures ≥1 change, so the loop above assigned rootTreeOid.
          tree: rootTreeOid!,
          parent: parentOid ? [parentOid] : [],
          author: { name: author.name, email: author.email, timestamp, timezoneOffset: 0 },
          committer: { name: author.name, email: author.email, timestamp, timezoneOffset: 0 },
          message,
        },
      })

      await git.writeRef({ fs, dir: this.dir, ref: `refs/heads/${branch}`, value: commitOid, force: true })
      return commitOid
    })
  }

  diff(a: string, b: string): Promise<DiffEntry[]> {
    return this.lock.run(async () => {
      const oidA = await git.resolveRef({ fs, dir: this.dir, ref: a })
      const oidB = await git.resolveRef({ fs, dir: this.dir, ref: b })
      const entries: DiffEntry[] = []
      await git.walk({
        fs,
        dir: this.dir,
        cache: this.cache,
        trees: [git.TREE({ ref: oidA }), git.TREE({ ref: oidB })],
        map: async (filepath, [treeA, treeB]) => {
          if (filepath === '.') return
          const [typeA, typeB] = await Promise.all([treeA?.type(), treeB?.type()])
          if (typeA === 'tree' || typeB === 'tree') return // descend into directories
          const [oA, oB] = await Promise.all([treeA?.oid(), treeB?.oid()])
          if (oA && !oB) entries.push({ path: filepath, status: 'removed' })
          else if (!oA && oB) entries.push({ path: filepath, status: 'added' })
          else if (oA && oB && oA !== oB) entries.push({ path: filepath, status: 'modified' })
          return
        },
      })
      return entries
    })
  }

  merge(from: string, into: string, author: Author): Promise<MergeResult> {
    return this.lock.run(async () => {
      const fromOid = await git.resolveRef({ fs, dir: this.dir, ref: from })
      const intoOid = await git.resolveRef({ fs, dir: this.dir, ref: into })

      if (fromOid === intoOid) {
        return { oid: intoOid, alreadyMerged: true, fastForward: false }
      }

      // Fast-forward: `from` is a descendant of `into` — just advance the ref, no working tree.
      const canFF = await git.isDescendent({ fs, dir: this.dir, oid: fromOid, ancestor: intoOid, depth: -1 })
      if (canFF) {
        await git.writeRef({ fs, dir: this.dir, ref: `refs/heads/${into}`, value: fromOid, force: true })
        return { oid: fromOid, alreadyMerged: false, fastForward: true }
      }

      // Non-fast-forward fallback (rare in Stage 1 — only if `into` diverged from `from`).
      await git.checkout({ fs, dir: this.dir, cache: this.cache, ref: into })
      const result = await git.merge({ fs, dir: this.dir, cache: this.cache, ours: into, theirs: from, author, fastForward: true })
      return {
        oid: result.oid ?? (await git.resolveRef({ fs, dir: this.dir, ref: into })),
        alreadyMerged: result.alreadyMerged ?? false,
        fastForward: result.fastForward ?? false,
      }
    })
  }

  log(branch: string, depth?: number): Promise<CommitInfo[]> {
    return this.lock.run(async () => {
      const commits = await git.log({ fs, dir: this.dir, cache: this.cache, ref: branch, depth })
      return commits.map((c) => ({
        oid: c.oid,
        message: c.commit.message.trim(),
        author: c.commit.author.name,
        timestamp: c.commit.author.timestamp,
      }))
    })
  }
}

/**
 * Recursively update a git tree to include `blobOid` at the nested path `pathParts`. Creates
 * intermediate trees as needed. Returns the oid of the updated (or newly created) root tree.
 *
 * Works purely on git object store — no working-tree or index interaction.
 */
async function upsertFileInTree(
  dir: string,
  treeOid: string | null,
  pathParts: string[],
  blobOid: string,
): Promise<string> {
  const entries = treeOid ? [...(await git.readTree({ fs, dir, oid: treeOid })).tree] : []
  const [name, ...rest] = pathParts
  if (!name) throw new Error('upsertFileInTree: empty path segment')

  if (rest.length === 0) {
    // Leaf: add or replace the blob entry.
    const i = entries.findIndex((e) => e.path === name)
    const entry = { mode: '100644' as const, path: name, oid: blobOid, type: 'blob' as const }
    if (i >= 0) entries[i] = entry
    else entries.push(entry)
  } else {
    // Intermediate directory: recurse into the subtree.
    const existing = entries.find((e) => e.path === name && e.type === 'tree')
    const subOid = await upsertFileInTree(dir, existing?.oid ?? null, rest, blobOid)
    const i = entries.findIndex((e) => e.path === name)
    const entry = { mode: '040000' as const, path: name, oid: subOid, type: 'tree' as const }
    if (i >= 0) entries[i] = entry
    else entries.push(entry)
  }

  return git.writeTree({ fs, dir, tree: entries })
}
