export type TeamType = 'private' | 'domain'

export type TeamRole = 'admin' | 'member'

export type TeamInvitationStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'revoked'

export interface Team {
  id: string
  name: string
  type: TeamType
  domain?: string
  createdBy: string
  createdAt: number
}

export interface TeamMember {
  teamId: string
  userId: string
  role: TeamRole
  contextEmail?: string
  joinedAt: number
}

export interface TeamMemberWithUser extends TeamMember {
  username: string
  name: string
  avatarUrl?: string
}

export interface TeamInvitation {
  id: string
  teamId: string
  invitedBy: string
  targetEmail?: string
  targetUsername?: string
  role: TeamRole
  status: TeamInvitationStatus
  expiresAt: number
  createdAt: number
  resolvedAt?: number
}

export interface TeamWithDetails extends Team {
  members: TeamMemberWithUser[]
  memberCount: number
  currentUserRole?: TeamRole
}
