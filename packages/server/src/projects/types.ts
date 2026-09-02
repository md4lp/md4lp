import type { TeamWithDetails } from '../teams/types'

export type ProjectRole = 'owner' | 'editor' | 'commenter' | 'viewer'

export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'revoked'

export interface Project {
  id: string
  name: string
  slug: string
  description?: string
  repoPath: string
  ownerUserId: string
  createdAt: number
  updatedAt: number
}

export interface ProjectMember {
  projectId: string
  userId: string
  role: ProjectRole
  contextEmail: string
  joinedAt: number
}

export interface ProjectMemberWithUser extends ProjectMember {
  username: string
  name: string
  avatarUrl?: string
}

export interface ProjectTeamAssignment {
  projectId: string
  teamId: string
  role: ProjectRole
  assignedAt: number
}

export interface ProjectTeamWithDetails extends ProjectTeamAssignment {
  teamName: string
  teamType: 'private' | 'domain'
  memberCount: number
}

export interface ProjectInvitation {
  id: string
  projectId: string
  invitedBy: string
  inviterName?: string
  role: ProjectRole
  targetUsername?: string
  targetEmail?: string
  status: InvitationStatus
  createdAt: number
  expiresAt: number
}

export interface ProjectWithDetails extends Project {
  members: ProjectMemberWithUser[]
  teams: ProjectTeamWithDetails[]
  effectiveRole?: ProjectRole
  currentContextEmail?: string
  pendingInvitations?: ProjectInvitation[]
}
