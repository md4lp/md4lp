import type { RepoBackend, Author } from '@md4lp/repo'
import { CommentStore, type Comment } from '@md4lp/comments'
import { merge3 } from '@md4lp/anchor'
import { ProjectService } from '../projects/service'
import type { DocumentTreeItem, DocumentInfo, DocumentLock, ConflictPreview } from './types'

export const editBranch = (path: string): string => `edit/${path}`
export const commentsBranch = (user: string): string => `comments/${user}`
export const isDocFile = (f: string): boolean => f.endsWith('.md') && !f.startsWith('.md4lp/')

export class DocumentService {
  private readonly locks = new Map<string, DocumentLock>() // key: `${projectId}:${path}`
  private readonly lockTimeoutMs: number

  constructor(
    private readonly projects: ProjectService,
    lockTimeoutMs = 30_000,
  ) {
    this.lockTimeoutMs = lockTimeoutMs
  }

  private lockKey(projectId: string, path: string): string {
    return `${projectId}:${path}`
  }

  isLockExpired(lock: DocumentLock): boolean {
    return Date.now() - lock.lastHeartbeat > this.lockTimeoutMs
  }

  getLockHolder(projectId: string, path: string): DocumentLock | undefined {
    const l = this.locks.get(this.lockKey(projectId, path))
    if (!l) return undefined
    if (this.isLockExpired(l)) {
      return undefined
    }
    return l
  }

  touchLock(projectId: string, path: string, editor: string): void {
    const l = this.locks.get(this.lockKey(projectId, path))
    if (l && l.editor === editor) {
      l.lastHeartbeat = Date.now()
    }
  }

  async acquireLock(
    projectId: string,
    path: string,
    editor: string,
    author: Author,
    agentSessionId?: string,
  ): Promise<{ branch: string; editor: string; baseOid?: string }> {
    const key = this.lockKey(projectId, path)
    const holder = this.getLockHolder(projectId, path)
    if (holder && holder.editor !== editor) {
      throw new Error(`document is being edited by ${holder.editor}`)
    }

    const repo = await this.projects.getProjectRepo(projectId)

    // If an idle prior holder existed and was different, consolidate their work first
    const prev = this.locks.get(key)
    if (prev && prev.editor !== editor) {
      await this.consolidate(projectId, path, prev.editor, author)
    }

    const baseOid = (await repo.head('main')) ?? undefined
    await repo.resetBranch(editBranch(path), 'main')

    this.locks.set(key, {
      projectId,
      path,
      editor,
      agentSessionId,
      lastHeartbeat: Date.now(),
      baseOid,
    })

    return { branch: editBranch(path), editor, baseOid }
  }

  async releaseLock(projectId: string, path: string, editor: string, author: Author): Promise<void> {
    const key = this.lockKey(projectId, path)
    const l = this.locks.get(key)
    if (!l || l.editor !== editor) {
      const holder = this.getLockHolder(projectId, path)
      throw new Error(`document is being edited by ${holder?.editor ?? 'another user'}`)
    }

    await this.consolidate(projectId, path, editor, author)
    this.locks.delete(key)
  }

  async consolidate(projectId: string, path: string, editor: string, author: Author): Promise<void> {
    const repo = await this.projects.getProjectRepo(projectId)
    const eb = editBranch(path)
    const ebHead = await repo.head(eb)
    if (!ebHead) return
    const mainHead = await repo.head('main')
    if (ebHead === mainHead) return

    const content = await repo.readFile(eb, path)
    await repo.writeFiles('main', [{ path, content }], `edit ${path}`, author)
  }

  // ── Publication and 3-Way Merge ──────────────────────────────────────────────

  async checkPublishConflict(
    projectId: string,
    path: string,
    editor: string,
  ): Promise<ConflictPreview> {
    const key = this.lockKey(projectId, path)
    const l = this.locks.get(key)
    if (!l || l.editor !== editor) {
      const holder = this.getLockHolder(projectId, path)
      throw new Error(`document is being edited by ${holder?.editor ?? 'another user'}`)
    }

    const repo = await this.projects.getProjectRepo(projectId)
    const currentMainHead = (await repo.head('main')) || ''
    const baseOid = l.baseOid || currentMainHead

    if (baseOid === currentMainHead) {
      return {
        hasConflict: false,
        baseOid,
        currentMainHead,
        chunks: [],
      }
    }

    // Main has moved since lock was acquired! Read base, editBranch (ours), and main (theirs)
    const baseContent = await repo.readFile(baseOid, path).catch(() => '')
    const oursContent = await repo.readFile(editBranch(path), path).catch(() => '')
    const mainContent = await repo.readFile('main', path).catch(() => '')

    const diff3Res = merge3(baseContent, oursContent, mainContent)

    return {
      hasConflict: diff3Res.conflict,
      baseOid,
      currentMainHead,
      chunks: diff3Res.chunks,
      resolvedContent: diff3Res.resolvedText,
    }
  }

  async publishDocument(
    projectId: string,
    path: string,
    editor: string,
    author: Author,
    options?: { resolvedContent?: string; message?: string },
  ): Promise<{ commitOid: string }> {
    const key = this.lockKey(projectId, path)
    const l = this.locks.get(key)
    if (!l || l.editor !== editor) {
      const holder = this.getLockHolder(projectId, path)
      throw new Error(`document is being edited by ${holder?.editor ?? 'another user'}`)
    }

    const repo = await this.projects.getProjectRepo(projectId)
    const currentMainHead = (await repo.head('main')) || ''
    const baseOid = l.baseOid || currentMainHead

    let contentToCommit: string

    if (options?.resolvedContent !== undefined) {
      contentToCommit = options.resolvedContent
    } else {
      if (baseOid !== currentMainHead) {
        // Main has moved; attempt clean automatic merge3 or fail if conflicting
        const baseContent = await repo.readFile(baseOid, path).catch(() => '')
        const oursContent = await repo.readFile(editBranch(path), path).catch(() => '')
        const mainContent = await repo.readFile('main', path).catch(() => '')

        const diff3Res = merge3(baseContent, oursContent, mainContent)
        if (diff3Res.conflict || diff3Res.resolvedText === undefined) {
          throw new Error('conflict detected with current main; manual resolution required')
        }
        contentToCommit = diff3Res.resolvedText
      } else {
        // Fast-forward
        contentToCommit = await repo.readFile(editBranch(path), path)
      }
    }

    const commitOid = await repo.writeFiles(
      'main',
      [{ path, content: contentToCommit }],
      options?.message ?? `publish ${path}`,
      author,
    )

    // Clean up edit branch & lock
    this.locks.delete(key)

    return { commitOid }
  }

  async listTree(projectId: string, branch = 'main'): Promise<DocumentTreeItem[]> {
    const repo = await this.projects.getProjectRepo(projectId)
    const allFiles = (await repo.listFiles(branch)).filter(isDocFile)
    
    // Build tree structure
    const root: DocumentTreeItem[] = []
    
    for (const filePath of allFiles) {
      const parts = filePath.split('/')
      let currentLevel = root

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] || ''
        const isFile = i === parts.length - 1
        const currentPath = parts.slice(0, i + 1).join('/')

        let existing: DocumentTreeItem | undefined = currentLevel.find((item) => item.name === part)
        if (!existing) {
          existing = {
            path: currentPath,
            name: part,
            type: isFile ? 'file' : 'directory',
            children: isFile ? undefined : [],
          }
          currentLevel.push(existing)
        }
        if (!isFile && existing.children) {
          currentLevel = existing.children
        }
      }
    }

    return root
  }

  async listFlatFiles(projectId: string, branch = 'main'): Promise<string[]> {
    const repo = await this.projects.getProjectRepo(projectId)
    const files = await repo.listFiles(branch)
    return files.filter(isDocFile)
  }

  async getDocument(projectId: string, path: string, branchOverride?: string): Promise<DocumentInfo> {
    const repo = await this.projects.getProjectRepo(projectId)
    const lock = this.getLockHolder(projectId, path)
    const branch = branchOverride ?? (lock ? editBranch(path) : 'main')
    const content = await repo.readFile(branch, path)

    return {
      projectId,
      path,
      branch,
      content,
      lock: {
        editor: lock?.editor ?? null,
        lastHeartbeat: lock?.lastHeartbeat,
      },
    }
  }

  async saveDraft(
    projectId: string,
    path: string,
    content: string,
    editor: string,
    author: Author,
    message?: string,
  ): Promise<{ oid: string; content: string }> {
    const key = this.lockKey(projectId, path)
    const l = this.locks.get(key)
    if (!l || l.editor !== editor) {
      const holder = this.getLockHolder(projectId, path)
      throw new Error(`document is being edited by ${holder?.editor ?? 'another user'}`)
    }

    const repo = await this.projects.getProjectRepo(projectId)
    // Live editor buffer is saved BYTE-EXACT (no forced lossy remark canonicalizer)
    const oid = await repo.writeFiles(editBranch(path), [{ path, content }], message ?? `edit ${path}`, author)
    this.touchLock(projectId, path, editor)
    return { oid, content }
  }

  async getCommentStore(projectId: string): Promise<CommentStore> {
    const repo = await this.projects.getProjectRepo(projectId)
    return new CommentStore(repo)
  }

  // ── Document Registry & Stable documentId ────────────────────────────────────

  private async loadDocumentRegistry(repo: RepoBackend): Promise<Record<string, string>> {
    try {
      const jsonStr = await repo.readFile('main', '.md4lp/documents.json')
      return JSON.parse(jsonStr)
    } catch {
      return {}
    }
  }

  async getDocumentId(projectId: string, path: string): Promise<string> {
    const repo = await this.projects.getProjectRepo(projectId)
    const registry = await this.loadDocumentRegistry(repo)
    return registry[path] || path
  }

  // ── Document CRUD & Tree Operations ─────────────────────────────────────────

  async createDocument(
    projectId: string,
    path: string,
    initialContent: string,
    author: Author,
    message?: string,
  ): Promise<{ path: string; documentId: string; commitOid: string }> {
    const repo = await this.projects.getProjectRepo(projectId)
    const head = await repo.head('main')
    const registry = await this.loadDocumentRegistry(repo)
    const documentId = crypto.randomUUID()
    registry[path] = documentId

    const res = await repo.applyTreeTransaction(
      'main',
      head,
      [
        { type: 'putContent', path, content: initialContent },
        { type: 'putContent', path: '.md4lp/documents.json', content: JSON.stringify(registry, null, 2) },
      ],
      message ?? `create ${path}`,
      author,
    )

    return { path, documentId, commitOid: res.commitOid }
  }

  async renameDocument(
    projectId: string,
    oldPath: string,
    newPath: string,
    author: Author,
    message?: string,
  ): Promise<{ commitOid: string }> {
    const repo = await this.projects.getProjectRepo(projectId)
    const head = await repo.head('main')
    const content = await repo.readFile('main', oldPath)
    const registry = await this.loadDocumentRegistry(repo)

    const docId = registry[oldPath] || crypto.randomUUID()
    delete registry[oldPath]
    registry[newPath] = docId

    // Scan all other Markdown files to patch relative links pointing to oldPath
    const allFiles = (await repo.listFiles('main')).filter(isDocFile)
    const ops: import('@md4lp/repo').TreeOperation[] = [
      { type: 'delete', path: oldPath },
      { type: 'putContent', path: newPath, content },
      { type: 'putContent', path: '.md4lp/documents.json', content: JSON.stringify(registry, null, 2) },
    ]

    for (const f of allFiles) {
      if (f === oldPath) continue
      const otherContent = await repo.readFile('main', f)
      const patched = patchRelativeLinks(otherContent, f, oldPath, newPath)
      if (patched !== otherContent) {
        ops.push({ type: 'putContent', path: f, content: patched })
      }
    }

    const res = await repo.applyTreeTransaction(
      'main',
      head,
      ops,
      message ?? `move ${oldPath} to ${newPath}`,
      author,
    )

    return { commitOid: res.commitOid }
  }

  async deleteDocument(
    projectId: string,
    path: string,
    author: Author,
    message?: string,
  ): Promise<{ commitOid: string }> {
    const repo = await this.projects.getProjectRepo(projectId)
    const head = await repo.head('main')
    const registry = await this.loadDocumentRegistry(repo)
    delete registry[path]

    const res = await repo.applyTreeTransaction(
      'main',
      head,
      [
        { type: 'delete', path },
        { type: 'putContent', path: '.md4lp/documents.json', content: JSON.stringify(registry, null, 2) },
      ],
      message ?? `delete ${path}`,
      author,
    )

    return { commitOid: res.commitOid }
  }
}

/**
 * Patch relative Markdown links in `sourceContent` when a target file moves from `oldPath` to `newPath`.
 */
function patchRelativeLinks(
  sourceContent: string,
  sourceFilePath: string,
  oldTargetFile: string,
  newTargetFile: string,
): string {
  return sourceContent.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('#') || url.startsWith('mailto:')) {
      return match
    }

    const [cleanUrl, hash] = url.split('#')
    const sourceDir = sourceFilePath.includes('/') ? sourceFilePath.slice(0, sourceFilePath.lastIndexOf('/')) : ''
    const resolvedOld = resolveRelativePath(sourceDir, cleanUrl)

    if (resolvedOld === oldTargetFile) {
      const newRel = computeRelativePath(sourceDir, newTargetFile)
      const fullNew = hash ? `${newRel}#${hash}` : newRel
      return `[${text}](${fullNew})`
    }

    return match
  })
}

function resolveRelativePath(baseDir: string, relPath: string): string {
  const parts = baseDir ? baseDir.split('/') : []
  const relSegments = relPath.split('/')
  for (const seg of relSegments) {
    if (seg === '.' || !seg) continue
    if (seg === '..') {
      parts.pop()
    } else {
      parts.push(seg)
    }
  }
  return parts.join('/')
}

function computeRelativePath(fromDir: string, toPath: string): string {
  if (!fromDir) return toPath
  const fromParts = fromDir.split('/')
  const toParts = toPath.split('/')

  let common = 0
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++
  }

  const ups = fromParts.length - common
  const relParts: string[] = []
  for (let i = 0; i < ups; i++) relParts.push('..')
  relParts.push(...toParts.slice(common))

  return relParts.join('/')
}
