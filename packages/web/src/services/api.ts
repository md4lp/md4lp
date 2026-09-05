export interface UserProfile {
  id: string
  name: string
  username: string
  avatarUrl?: string
  defaultEmail?: string
  emails: Array<{ email: string; verified: boolean; primary: boolean }>
}

export interface ProjectSummary {
  id: string
  name: string
  slug: string
  description?: string
  effectiveRole: 'owner' | 'editor' | 'commenter' | 'viewer'
  createdAt: string
  currentContextEmail?: string
  stats?: {
    documentsCount: number
    directMembersCount: number
    teamsCount: number
  }
}

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

class ApiClient {
  private token: string | null = null
  private clientId: string

  constructor() {
    let token: string | null = null
    let clientId: string | null = null
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        token = window.localStorage.getItem('md4lp_token')
        clientId = window.localStorage.getItem('md4lp_client_id')
      }
    } catch {}

    this.token = token
    this.clientId = clientId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'client-' + Math.random().toString(36).slice(2))
    
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('md4lp_client_id', this.clientId)
      }
    } catch {}
  }

  setToken(token: string | null) {
    this.token = token
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        if (token) {
          window.localStorage.setItem('md4lp_token', token)
        } else {
          window.localStorage.removeItem('md4lp_token')
        }
      }
    } catch {}
  }

  getToken(): string | null {
    return this.token
  }

  getClientId(): string {
    return this.clientId
  }

  async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers || {})
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`)
    }
    headers.set('X-Client-Id', this.clientId)
    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json')
    }

    const res = await fetch(endpoint, {
      ...options,
      headers,
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error || `Request failed with status ${res.status}`)
    }
    return data as T
  }

  // Auth & Profile
  async getMe(): Promise<{ ok: boolean; user: UserProfile; currentEmail?: string }> {
    const res = await this.request<{ ok: boolean; user: any; currentEmail?: string }>('/api/auth/me')
    if (res.user) {
      res.user = this.normalizeUserProfile(res.user)
    }
    return res
  }

  private normalizeUserProfile(rawUser: any): UserProfile {
    const rawEmails = Array.isArray(rawUser.emails) ? rawUser.emails : []
    const emails = rawEmails.map((e: any) => ({
      email: e.email,
      verified: e.verified ?? Boolean(e.verifiedAt),
      primary: e.primary ?? Boolean(e.isPrimary),
    }))

    const defaultEmail = rawUser.defaultEmail || emails.find((e: any) => e.primary && e.verified)?.email || emails.find((e: any) => e.verified)?.email || (emails[0]?.email ?? '')

    return {
      id: rawUser.id,
      name: rawUser.name || '',
      username: rawUser.username || '',
      avatarUrl: rawUser.avatarUrl,
      defaultEmail,
      emails,
    }
  }

  async lookupIdentifier(identifier: string): Promise<{ exists: boolean; email?: string; username?: string }> {
    return this.request('/api/auth/lookup', {
      method: 'POST',
      body: JSON.stringify({ identifier }),
    })
  }

  async requestCode(params: { identifier: string; purpose?: string; name?: string; username?: string }): Promise<any> {
    return this.request('/api/auth/request-code', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async verifyCode(params: { identifier: string; code: string; purpose?: string; name?: string; username?: string }): Promise<{ ok: boolean; token: string; user: UserProfile }> {
    const res = await this.request('/api/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    if (res.token) {
      this.setToken(res.token)
    }
    if (res.user) {
      res.user = this.normalizeUserProfile(res.user)
    }
    return res
  }

  async logout(): Promise<void> {
    try {
      await this.request('/api/auth/logout', { method: 'POST' })
    } finally {
      this.setToken(null)
    }
  }

  // Projects
  async listProjects(): Promise<{ ok: boolean; projects: ProjectSummary[] }> {
    return this.request('/api/projects')
  }

  async getProjectDetails(projectId: string): Promise<{ ok: boolean; project: any }> {
    return this.request(`/api/projects/${projectId}`)
  }

  async createProject(params: { name: string; slug?: string; description?: string; contextEmail?: string }): Promise<{ ok: boolean; project: any }> {
    return this.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  // Documents
  async listTree(projectId: string, branch = 'main'): Promise<{ ok: boolean; tree: DocumentTreeItem[] }> {
    return this.request(`/api/projects/${projectId}/tree?branch=${encodeURIComponent(branch)}`)
  }

  async getDocument(projectId: string, path: string, branch?: string): Promise<{ ok: boolean } & DocumentInfo> {
    const url = `/api/projects/${projectId}/file?path=${encodeURIComponent(path)}${branch ? `&branch=${encodeURIComponent(branch)}` : ''}`
    return this.request(url)
  }

  async createDocument(projectId: string, path: string, content = '', message?: string): Promise<{ ok: boolean; path: string; documentId: string; commitOid: string }> {
    return this.request(`/api/projects/${projectId}/documents/create`, {
      method: 'POST',
      body: JSON.stringify({ path, content, message }),
    })
  }

  async renameDocument(projectId: string, oldPath: string, newPath: string, message?: string): Promise<{ ok: boolean; commitOid: string }> {
    return this.request(`/api/projects/${projectId}/documents/rename`, {
      method: 'POST',
      body: JSON.stringify({ oldPath, newPath, message }),
    })
  }

  async deleteDocument(projectId: string, path: string, message?: string): Promise<{ ok: boolean; commitOid: string }> {
    return this.request(`/api/projects/${projectId}/documents/delete`, {
      method: 'POST',
      body: JSON.stringify({ path, message }),
    })
  }

  async acquireLock(projectId: string, path: string): Promise<{ ok: boolean; branch: string; editor: string }> {
    return this.request(`/api/projects/${projectId}/lock/acquire`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    })
  }

  async heartbeatLock(projectId: string, path: string): Promise<{ ok: boolean }> {
    return this.request(`/api/projects/${projectId}/lock/heartbeat`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    })
  }

  async releaseLock(projectId: string, path: string): Promise<{ ok: boolean }> {
    return this.request(`/api/projects/${projectId}/lock/release`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    })
  }

  async saveDraft(projectId: string, path: string, content: string, message?: string): Promise<{ ok: boolean; oid: string; content: string }> {
    return this.request(`/api/projects/${projectId}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path, content, message }),
    })
  }

  async checkPublishConflict(projectId: string, path: string): Promise<{ ok: boolean } & ConflictPreview> {
    return this.request(`/api/projects/${projectId}/documents/check-conflict`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    })
  }

  async publishDocument(projectId: string, path: string, resolvedContent?: string, message?: string): Promise<{ ok: boolean; commitOid: string }> {
    return this.request(`/api/projects/${projectId}/documents/publish`, {
      method: 'POST',
      body: JSON.stringify({ path, resolvedContent, message }),
    })
  }

  // Comments & Suggestions
  async getComments(projectId: string, path: string): Promise<{ ok: boolean; comments: import('../types').Sidecar[] }> {
    return this.request(`/api/projects/${projectId}/comments?path=${encodeURIComponent(path)}`)
  }

  async addComment(projectId: string, path: string, start: number, end: number, body: string, suggestion?: string): Promise<{ ok: boolean; comment: any }> {
    return this.request(`/api/projects/${projectId}/comment?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      body: JSON.stringify({ start, end, body, suggestion }),
    })
  }

  async addReply(projectId: string, path: string, owner: string, parentId: string, body: string): Promise<{ ok: boolean }> {
    return this.request(`/api/projects/${projectId}/reply?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      body: JSON.stringify({ owner, parentId, body }),
    })
  }

  async toggleReaction(projectId: string, path: string, owner: string, nodeId: string, emoji: string): Promise<{ ok: boolean }> {
    return this.request(`/api/projects/${projectId}/react?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      body: JSON.stringify({ owner, nodeId, emoji }),
    })
  }

  async applySuggestion(projectId: string, path: string, owner: string, commentId: string): Promise<{ ok: boolean; applied: boolean; oid: string }> {
    return this.request(`/api/projects/${projectId}/suggestion/apply?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      body: JSON.stringify({ owner, commentId }),
    })
  }

  async rejectSuggestion(projectId: string, path: string, owner: string, commentId: string): Promise<{ ok: boolean; rejected: boolean }> {
    return this.request(`/api/projects/${projectId}/suggestion/reject?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      body: JSON.stringify({ owner, commentId }),
    })
  }

  // Teams
  async listTeams(): Promise<{ ok: boolean; teams: any[]; domainTeams: any[] }> {
    const res = await this.request<{ ok: boolean; joinedTeams?: any[]; availableDomainTeams?: any[]; teams?: any[]; domainTeams?: any[] }>('/api/teams')
    return {
      ok: res.ok,
      teams: res.joinedTeams || res.teams || [],
      domainTeams: res.availableDomainTeams || res.domainTeams || [],
    }
  }

  async createTeam(name: string): Promise<{ ok: boolean; team: any }> {
    return this.request('/api/teams', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  }

  async joinDomainTeam(teamId: string, contextEmail: string): Promise<{ ok: boolean; team: any }> {
    return this.request('/api/teams/join-domain', {
      method: 'POST',
      body: JSON.stringify({ teamId, contextEmail }),
    })
  }

  // Pending Invitations
  async listPendingTeamInvitations(): Promise<{ ok: boolean; invitations: any[] }> {
    return this.request('/api/teams/invitations/pending')
  }

  async listPendingProjectInvitations(): Promise<{ ok: boolean; invitations: any[] }> {
    return this.request('/api/projects/invitations/pending')
  }

  async acceptProjectInvitation(invitationId: string, contextEmail?: string): Promise<{ ok: boolean }> {
    return this.request(`/api/projects/invitations/${invitationId}/accept`, {
      method: 'POST',
      body: JSON.stringify({ contextEmail }),
    })
  }

  async rejectProjectInvitation(invitationId: string): Promise<{ ok: boolean }> {
    return this.request(`/api/projects/invitations/${invitationId}/reject`, {
      method: 'POST',
    })
  }

  async revokeProjectInvitation(projectId: string, invitationId: string): Promise<{ ok: boolean }> {
    return this.request(`/api/projects/invitations/${invitationId}`, {
      method: 'DELETE',
    })
  }

  async acceptTeamInvitation(invitationId: string, contextEmail?: string): Promise<{ ok: boolean }> {
    return this.request(`/api/teams/invitations/${invitationId}/accept`, {
      method: 'POST',
      body: JSON.stringify({ contextEmail }),
    })
  }

  async rejectTeamInvitation(invitationId: string): Promise<{ ok: boolean }> {
    return this.request(`/api/teams/invitations/${invitationId}/reject`, {
      method: 'POST',
    })
  }

  // Account & Multi-Email
  async requestAddEmail(email: string): Promise<{ ok: boolean }> {
    return this.request('/api/auth/emails/request-add', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  }

  async verifyAddEmail(email: string, code: string): Promise<{ ok: boolean }> {
    return this.request('/api/auth/emails/verify-add', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    })
  }

  async setPrimaryEmail(email: string): Promise<{ ok: boolean }> {
    return this.request('/api/auth/emails/primary', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  }

  async removeEmail(email: string): Promise<{ ok: boolean }> {
    return this.request('/api/auth/emails', {
      method: 'DELETE',
      body: JSON.stringify({ email }),
    })
  }

  async updateProfile(params: { name?: string; username?: string; avatarUrl?: string }): Promise<{ ok: boolean }> {
    return this.request('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(params),
    })
  }

  // Agent Sessions & Grants
  async listAgentSessions(): Promise<{ ok: boolean; sessions: any[] }> {
    return this.request('/api/auth/agent-sessions')
  }

  async revokeAgentSession(sessionId: string): Promise<{ ok: boolean }> {
    return this.request(`/api/auth/agent-sessions/${sessionId}`, {
      method: 'DELETE',
    })
  }

  async createAgentGrant(params: { agentName: string; codeChallenge: string; projectScopes: Array<{ projectId: string; maxRole: string }> }): Promise<{ ok: boolean; code: string; expiresAt: number }> {
    return this.request('/api/auth/agent-grants', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  // Teams Management
  async getTeamDetails(teamId: string): Promise<{ ok: boolean; team: any }> {
    return this.request(`/api/teams/${teamId}`)
  }

  async inviteTeamMember(teamId: string, target: string, role: 'admin' | 'member' = 'member'): Promise<{ ok: boolean; invitation: any }> {
    return this.request(`/api/teams/${teamId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ target, role }),
    })
  }

  async leaveTeam(teamId: string): Promise<{ ok: boolean }> {
    return this.request(`/api/teams/${teamId}/leave`, {
      method: 'POST',
    })
  }

  async expelDomainMember(teamId: string, targetUserId: string, reverificationCode: string): Promise<{ ok: boolean }> {
    return this.request(`/api/teams/${teamId}/expel-domain`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId, reverificationCode }),
    })
  }

  async removeTeamMember(teamId: string, targetUserId: string, reverificationCode: string): Promise<{ ok: boolean }> {
    return this.request(`/api/teams/${teamId}/members/remove`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId, reverificationCode }),
    })
  }

  // Project Settings & Team Assignment
  async inviteProjectMember(projectId: string, target: string, role: string = 'editor'): Promise<{ ok: boolean; invitation: any }> {
    return this.request(`/api/projects/${projectId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ target, role }),
    })
  }

  async assignProjectTeam(projectId: string, teamId: string, role: string = 'editor'): Promise<{ ok: boolean }> {
    return this.request(`/api/projects/${projectId}/teams`, {
      method: 'POST',
      body: JSON.stringify({ teamId, role }),
    })
  }

  async removeProjectTeam(projectId: string, teamId: string): Promise<{ ok: boolean }> {
    return this.request(`/api/projects/${projectId}/teams/${teamId}`, {
      method: 'DELETE',
    })
  }

  async updateProjectContextEmail(projectId: string, contextEmail: string): Promise<{ ok: boolean }> {
    return this.request(`/api/projects/${projectId}/context-email`, {
      method: 'POST',
      body: JSON.stringify({ contextEmail }),
    })
  }

  async removeProjectMember(projectId: string, targetUserId: string, reverificationCode: string): Promise<{ ok: boolean }> {
    return this.request(`/api/projects/${projectId}/members/remove`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId, reverificationCode }),
    })
  }

  async leaveProject(projectId: string): Promise<{ ok: boolean }> {
    return this.request(`/api/projects/${projectId}/leave`, {
      method: 'POST',
    })
  }

  // Dev Outbox helper
  async getDevOutbox(to?: string): Promise<{ ok: boolean; emails: any[] }> {
    return this.request(`/api/dev/outbox${to ? `?to=${encodeURIComponent(to)}` : ''}`)
  }
}

export const api = new ApiClient()
