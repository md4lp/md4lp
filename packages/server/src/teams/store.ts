import { randomUUID } from 'node:crypto'
import type { Team, TeamInvitation, TeamInvitationStatus, TeamMember, TeamRole } from './types'

export interface TeamStore {
  createTeam(name: string, type: 'private' | 'domain', createdBy: string, domain?: string): Promise<Team>
  getTeam(teamId: string): Promise<Team | null>
  getTeamByDomain(domain: string): Promise<Team | null>
  listTeamsForUser(userId: string): Promise<Team[]>
  addMember(teamId: string, userId: string, role: TeamRole, contextEmail?: string): Promise<TeamMember>
  removeMember(teamId: string, userId: string): Promise<void>
  updateMemberRole(teamId: string, userId: string, role: TeamRole): Promise<void>
  getMember(teamId: string, userId: string): Promise<TeamMember | null>
  listMembers(teamId: string): Promise<TeamMember[]>
  createInvitation(
    teamId: string,
    invitedBy: string,
    role: TeamRole,
    target: { email?: string; username?: string },
    expiresInMs?: number,
  ): Promise<TeamInvitation>
  getInvitation(invitationId: string): Promise<TeamInvitation | null>
  updateInvitationStatus(invitationId: string, status: TeamInvitationStatus): Promise<void>
  listPendingInvitationsForUser(emails: string[], username: string): Promise<TeamInvitation[]>
  listInvitationsForTeam(teamId: string): Promise<TeamInvitation[]>
}

export class MemoryTeamStore implements TeamStore {
  private teams = new Map<string, Team>()
  private domainTeams = new Map<string, string>() // domain -> teamId
  private members = new Map<string, TeamMember[]>() // teamId -> TeamMember[]
  private invitations = new Map<string, TeamInvitation>() // invitationId -> TeamInvitation

  async createTeam(name: string, type: 'private' | 'domain', createdBy: string, domain?: string): Promise<Team> {
    const id = randomUUID()
    const now = Date.now()
    const normDomain = domain ? domain.trim().toLowerCase() : undefined

    if (type === 'domain' && normDomain) {
      if (this.domainTeams.has(normDomain)) {
        const existingId = this.domainTeams.get(normDomain)!
        const existing = this.teams.get(existingId)
        if (existing) return { ...existing }
      }
    }

    const team: Team = {
      id,
      name: name.trim(),
      type,
      domain: normDomain,
      createdBy,
      createdAt: now,
    }

    this.teams.set(id, team)
    this.members.set(id, [])

    if (type === 'domain' && normDomain) {
      this.domainTeams.set(normDomain, id)
    }

    return { ...team }
  }

  async getTeam(teamId: string): Promise<Team | null> {
    const team = this.teams.get(teamId)
    return team ? { ...team } : null
  }

  async getTeamByDomain(domain: string): Promise<Team | null> {
    const norm = domain.trim().toLowerCase()
    const teamId = this.domainTeams.get(norm)
    if (!teamId) return null
    return this.getTeam(teamId)
  }

  async listTeamsForUser(userId: string): Promise<Team[]> {
    const result: Team[] = []
    for (const [teamId, memberList] of this.members.entries()) {
      if (memberList.some((m) => m.userId === userId)) {
        const team = this.teams.get(teamId)
        if (team) result.push({ ...team })
      }
    }
    return result
  }

  async addMember(teamId: string, userId: string, role: TeamRole, contextEmail?: string): Promise<TeamMember> {
    const list = this.members.get(teamId) ?? []
    const existingIdx = list.findIndex((m) => m.userId === userId)
    const now = Date.now()
    const member: TeamMember = {
      teamId,
      userId,
      role,
      contextEmail: contextEmail ? contextEmail.trim().toLowerCase() : undefined,
      joinedAt: now,
    }

    if (existingIdx !== -1) {
      list[existingIdx] = member
    } else {
      list.push(member)
    }

    this.members.set(teamId, list)
    return { ...member }
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    const list = this.members.get(teamId) ?? []
    const filtered = list.filter((m) => m.userId !== userId)
    this.members.set(teamId, filtered)
  }

  async updateMemberRole(teamId: string, userId: string, role: TeamRole): Promise<void> {
    const list = this.members.get(teamId) ?? []
    const member = list.find((m) => m.userId === userId)
    if (member) {
      member.role = role
    }
  }

  async getMember(teamId: string, userId: string): Promise<TeamMember | null> {
    const list = this.members.get(teamId) ?? []
    const member = list.find((m) => m.userId === userId)
    return member ? { ...member } : null
  }

  async listMembers(teamId: string): Promise<TeamMember[]> {
    const list = this.members.get(teamId) ?? []
    return list.map((m) => ({ ...m }))
  }

  async createInvitation(
    teamId: string,
    invitedBy: string,
    role: TeamRole,
    target: { email?: string; username?: string },
    expiresInMs = 7 * 24 * 60 * 60 * 1000, // 7 days
  ): Promise<TeamInvitation> {
    const id = randomUUID()
    const now = Date.now()
    const targetEmail = target.email ? target.email.trim().toLowerCase() : undefined
    const targetUsername = target.username ? target.username.trim().replace(/^@+/, '').toLowerCase() : undefined

    const invitation: TeamInvitation = {
      id,
      teamId,
      invitedBy,
      targetEmail,
      targetUsername,
      role,
      status: 'pending',
      expiresAt: now + expiresInMs,
      createdAt: now,
    }

    this.invitations.set(id, invitation)
    return { ...invitation }
  }

  async getInvitation(invitationId: string): Promise<TeamInvitation | null> {
    const inv = this.invitations.get(invitationId)
    if (!inv) return null
    if (inv.status === 'pending' && Date.now() > inv.expiresAt) {
      inv.status = 'expired'
    }
    return { ...inv }
  }

  async updateInvitationStatus(invitationId: string, status: TeamInvitationStatus): Promise<void> {
    const inv = this.invitations.get(invitationId)
    if (inv) {
      inv.status = status
      inv.resolvedAt = Date.now()
    }
  }

  async listPendingInvitationsForUser(emails: string[], username: string): Promise<TeamInvitation[]> {
    const now = Date.now()
    const normEmails = emails.map((e) => e.trim().toLowerCase())
    const normUser = username.trim().replace(/^@+/, '').toLowerCase()
    const result: TeamInvitation[] = []

    for (const inv of this.invitations.values()) {
      if (inv.status === 'pending') {
        if (now > inv.expiresAt) {
          inv.status = 'expired'
          continue
        }
        const matchEmail = inv.targetEmail && normEmails.includes(inv.targetEmail)
        const matchUsername = inv.targetUsername && inv.targetUsername === normUser
        if (matchEmail || matchUsername) {
          result.push({ ...inv })
        }
      }
    }
    return result
  }

  async listInvitationsForTeam(teamId: string): Promise<TeamInvitation[]> {
    const now = Date.now()
    const result: TeamInvitation[] = []
    for (const inv of this.invitations.values()) {
      if (inv.teamId === teamId) {
        if (inv.status === 'pending' && now > inv.expiresAt) {
          inv.status = 'expired'
        }
        result.push({ ...inv })
      }
    }
    return result
  }
}
