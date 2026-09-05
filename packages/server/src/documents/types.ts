export interface DocumentTreeItem {
  id?: string
  path: string
  name: string
  type: 'file' | 'directory'
  children?: DocumentTreeItem[]
  size?: number
}

export interface DocumentInfo {
  id?: string
  projectId: string
  path: string
  branch: string
  content: string
  lock: {
    editor: string | null
    lastHeartbeat?: number
    expiresInMs?: number
  }
}

export interface TreeOperation {
  type: 'putContent' | 'putBlob' | 'delete'
  path: string
  content?: string
  blobOid?: string
}

export interface DocumentLock {
  projectId: string
  path: string
  editor: string
  agentSessionId?: string
  lastHeartbeat: number
  baseOid?: string
}

export interface ConflictBlock {
  type: 'clean' | 'conflict'
  ours: string
  theirs: string
  base?: string
  merged?: string
}

export interface ConflictPreview {
  hasConflict: boolean
  baseOid: string
  currentMainHead: string
  chunks: ConflictBlock[]
  resolvedContent?: string
}
