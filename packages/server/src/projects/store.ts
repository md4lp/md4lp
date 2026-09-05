import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  Project,
  ProjectMember,
  ProjectTeamAssignment,
  ProjectInvitation,
  ProjectRole,
  InvitationStatus,
} from './types'

export interface ProjectStore {
  createProject(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project>
  getProject(projectId: string): Promise<Project | null>
  getProjectBySlug(slug: string): Promise<Project | null>
  updateProject(projectId: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>): Promise<Project | null>
  deleteProject(projectId: string): Promise<boolean>
  listAllProjects(): Promise<Project[]>

  addMember(projectId: string, userId: string, role: ProjectRole, contextEmail: string): Promise<ProjectMember>
  getMember(projectId: string, userId: string): Promise<ProjectMember | null>
  updateMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<ProjectMember | null>
  updateMemberContextEmail(projectId: string, userId: string, contextEmail: string): Promise<ProjectMember | null>
  removeMember(projectId: string, userId: string): Promise<boolean>
  listMembers(projectId: string): Promise<ProjectMember[]>
  listProjectsForUser(userId: string): Promise<Project[]>

  assignTeam(projectId: string, teamId: string, role: ProjectRole): Promise<ProjectTeamAssignment>
  removeTeam(projectId: string, teamId: string): Promise<boolean>
  listTeamsForProject(projectId: string): Promise<ProjectTeamAssignment[]>
  listProjectAssignmentsForTeam(teamId: string): Promise<ProjectTeamAssignment[]>

  createInvitation(
    projectId: string,
    invitedBy: string,
    role: ProjectRole,
    target: { email?: string; username?: string },
    expiresInMs?: number,
  ): Promise<ProjectInvitation>
  getInvitation(invitationId: string): Promise<ProjectInvitation | null>
  updateInvitationStatus(invitationId: string, status: InvitationStatus): Promise<ProjectInvitation | null>
  updateInvitationRole(invitationId: string, role: ProjectRole): Promise<ProjectInvitation | null>
  listPendingInvitationsForUser(verifiedEmails: string[], username: string): Promise<ProjectInvitation[]>
  listInvitationsForProject(projectId: string): Promise<ProjectInvitation[]>
}

export class MemoryProjectStore implements ProjectStore {
  private projects = new Map<string, Project>()
  private members = new Map<string, ProjectMember[]>() // key: projectId
  private teamAssignments = new Map<string, ProjectTeamAssignment[]>() // key: projectId
  private invitations = new Map<string, ProjectInvitation>() // key: invitationId

  constructor(private persistPath?: string) {
    if (persistPath && existsSync(persistPath)) {
      try {
        const raw = readFileSync(persistPath, 'utf-8')
        const data = JSON.parse(raw)
        if (data.projects) this.projects = new Map(Object.entries(data.projects))
        if (data.members) this.members = new Map(Object.entries(data.members))
        if (data.teamAssignments) this.teamAssignments = new Map(Object.entries(data.teamAssignments))
        if (data.invitations) this.invitations = new Map(Object.entries(data.invitations))
      } catch (err) {
        console.warn(`[ProjectStore] Failed to load from ${persistPath}:`, err)
      }
    }
  }

  private save(): void {
    if (!this.persistPath) return
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true })
      const data = {
        projects: Object.fromEntries(this.projects.entries()),
        members: Object.fromEntries(this.members.entries()),
        teamAssignments: Object.fromEntries(this.teamAssignments.entries()),
        invitations: Object.fromEntries(this.invitations.entries()),
      }
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      console.warn(`[ProjectStore] Failed to save to ${this.persistPath}:`, err)
    }
  }

  async createProject(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> {
    const id = randomUUID()
    const now = Date.now()
    const project: Project = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    }
    this.projects.set(id, project)
    this.members.set(id, [])
    this.teamAssignments.set(id, [])
    this.save()
    return project
  }

  async getProject(projectId: string): Promise<Project | null> {
    return this.projects.get(projectId) ?? null
  }

  async getProjectBySlug(slug: string): Promise<Project | null> {
    const normalized = slug.trim().toLowerCase()
    for (const p of this.projects.values()) {
      if (p.slug.toLowerCase() === normalized) return p
    }
    return null
  }

  async updateProject(projectId: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>): Promise<Project | null> {
    const p = this.projects.get(projectId)
    if (!p) return null
    const updated: Project = {
      ...p,
      ...patch,
      updatedAt: Date.now(),
    }
    this.projects.set(projectId, updated)
    this.save()
    return updated
  }

  async deleteProject(projectId: string): Promise<boolean> {
    this.members.delete(projectId)
    this.teamAssignments.delete(projectId)
    for (const [invId, inv] of this.invitations.entries()) {
      if (inv.projectId === projectId) this.invitations.delete(invId)
    }
    const res = this.projects.delete(projectId)
    this.save()
    return res
  }

  async listAllProjects(): Promise<Project[]> {
    return Array.from(this.projects.values())
  }

  async addMember(projectId: string, userId: string, role: ProjectRole, contextEmail: string): Promise<ProjectMember> {
    const list = this.members.get(projectId) ?? []
    const existingIdx = list.findIndex((m) => m.userId === userId)
    const member: ProjectMember = {
      projectId,
      userId,
      role,
      contextEmail,
      joinedAt: existingIdx >= 0 ? list[existingIdx]!.joinedAt : Date.now(),
    }
    if (existingIdx >= 0) {
      list[existingIdx] = member
    } else {
      list.push(member)
    }
    this.members.set(projectId, list)
    this.save()
    return member
  }

  async getMember(projectId: string, userId: string): Promise<ProjectMember | null> {
    const list = this.members.get(projectId) ?? []
    return list.find((m) => m.userId === userId) ?? null
  }

  async updateMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<ProjectMember | null> {
    const list = this.members.get(projectId) ?? []
    const m = list.find((item) => item.userId === userId)
    if (!m) return null
    m.role = role
    this.save()
    return m
  }

  async updateMemberContextEmail(projectId: string, userId: string, contextEmail: string): Promise<ProjectMember | null> {
    const list = this.members.get(projectId) ?? []
    const m = list.find((item) => item.userId === userId)
    if (!m) return null
    m.contextEmail = contextEmail
    this.save()
    return m
  }

  async removeMember(projectId: string, userId: string): Promise<boolean> {
    const list = this.members.get(projectId) ?? []
    const initialLen = list.length
    const filtered = list.filter((m) => m.userId !== userId)
    this.members.set(projectId, filtered)
    this.save()
    return filtered.length < initialLen
  }

  async listMembers(projectId: string): Promise<ProjectMember[]> {
    return this.members.get(projectId) ?? []
  }

  async listProjectsForUser(userId: string): Promise<Project[]> {
    const result: Project[] = []
    for (const [projectId, memList] of this.members.entries()) {
      if (memList.some((m) => m.userId === userId)) {
        const p = this.projects.get(projectId)
        if (p) result.push(p)
      }
    }
    return result
  }

  async assignTeam(projectId: string, teamId: string, role: ProjectRole): Promise<ProjectTeamAssignment> {
    const list = this.teamAssignments.get(projectId) ?? []
    const existingIdx = list.findIndex((t) => t.teamId === teamId)
    const assignment: ProjectTeamAssignment = {
      projectId,
      teamId,
      role,
      assignedAt: existingIdx >= 0 ? list[existingIdx]!.assignedAt : Date.now(),
    }
    if (existingIdx >= 0) {
      list[existingIdx] = assignment
    } else {
      list.push(assignment)
    }
    this.teamAssignments.set(projectId, list)
    this.save()
    return assignment
  }

  async removeTeam(projectId: string, teamId: string): Promise<boolean> {
    const list = this.teamAssignments.get(projectId) ?? []
    const initialLen = list.length
    const filtered = list.filter((t) => t.teamId !== teamId)
    this.teamAssignments.set(projectId, filtered)
    this.save()
    return filtered.length < initialLen
  }

  async listTeamsForProject(projectId: string): Promise<ProjectTeamAssignment[]> {
    return this.teamAssignments.get(projectId) ?? []
  }

  async listProjectAssignmentsForTeam(teamId: string): Promise<ProjectTeamAssignment[]> {
    const result: ProjectTeamAssignment[] = []
    for (const assignments of this.teamAssignments.values()) {
      for (const a of assignments) {
        if (a.teamId === teamId) result.push(a)
      }
    }
    return result
  }

  async createInvitation(
    projectId: string,
    invitedBy: string,
    role: ProjectRole,
    target: { email?: string; username?: string },
    expiresInMs = 7 * 24 * 60 * 60 * 1000,
  ): Promise<ProjectInvitation> {
    const id = randomUUID()
    const now = Date.now()
    const inv: ProjectInvitation = {
      id,
      projectId,
      invitedBy,
      role,
      targetEmail: target.email ? target.email.toLowerCase() : undefined,
      targetUsername: target.username ? target.username.toLowerCase() : undefined,
      status: 'pending',
      createdAt: now,
      expiresAt: now + expiresInMs,
    }
    this.invitations.set(id, inv)
    this.save()
    return inv
  }

  async getInvitation(invitationId: string): Promise<ProjectInvitation | null> {
    const inv = this.invitations.get(invitationId)
    if (!inv) return null
    if (inv.status === 'pending' && Date.now() > inv.expiresAt) {
      inv.status = 'expired'
    }
    return inv
  }

  async updateInvitationStatus(invitationId: string, status: InvitationStatus): Promise<ProjectInvitation | null> {
    const inv = this.invitations.get(invitationId)
    if (!inv) return null
    inv.status = status
    this.save()
    return inv
  }

  async updateInvitationRole(invitationId: string, role: ProjectRole): Promise<ProjectInvitation | null> {
    const inv = this.invitations.get(invitationId)
    if (!inv) return null
    inv.role = role
    this.save()
    return inv
  }

  async listPendingInvitationsForUser(verifiedEmails: string[], username: string): Promise<ProjectInvitation[]> {
    const now = Date.now()
    const lowerEmails = verifiedEmails.map((e) => e.toLowerCase())
    const lowerUsername = username.toLowerCase()

    const result: ProjectInvitation[] = []
    for (const inv of this.invitations.values()) {
      if (inv.status === 'pending') {
        if (now > inv.expiresAt) {
          inv.status = 'expired'
          continue
        }
        const matchEmail = inv.targetEmail && lowerEmails.includes(inv.targetEmail)
        const matchUsername = inv.targetUsername && inv.targetUsername === lowerUsername
        if (matchEmail || matchUsername) {
          result.push(inv)
        }
      }
    }
    return result
  }

  async listInvitationsForProject(projectId: string): Promise<ProjectInvitation[]> {
    const now = Date.now()
    const result: ProjectInvitation[] = []
    for (const inv of this.invitations.values()) {
      if (inv.projectId === projectId) {
        if (inv.status === 'pending' && now > inv.expiresAt) {
          inv.status = 'expired'
        }
        result.push(inv)
      }
    }
    return result
  }
}
