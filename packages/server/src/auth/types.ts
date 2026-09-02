export type VerificationPurpose =
  | 'login'
  | 'register'
  | 'add_email'
  | 'reverify'
  | 'join_domain_team'
  | 'expel_member'
  | 'remove_team_member'
  | 'remove_project_member'

export interface User {
  id: string
  username: string
  name: string
  avatarUrl?: string
  status?: 'active' | 'suspended'
  createdAt: number
}

export interface UserEmail {
  email: string
  userId: string
  verifiedAt: number | null
  isPrimary: boolean
  createdAt: number
}

export interface VerificationCodeRecord {
  id: string
  email: string
  purpose: VerificationPurpose | string
  codeHash: string
  salt: string
  expiresAt: number
  attemptsLeft: number
  consumedAt: number | null
  metadata?: Record<string, unknown>
  createdAt: number
  seq?: number
}

export interface Session {
  token: string
  userId: string
  email: string
  expiresAt: number
  createdAt: number
}

export interface OutboxEmail {
  id: string
  to: string
  subject: string
  purpose: string
  code: string
  body: string
  sentAt: number
}

export interface UserWithEmails extends User {
  defaultEmail: string
  emails: UserEmail[]
}

export type UserProfile = UserWithEmails

export type DelegatedAgentRole = 'editor' | 'commenter' | 'viewer'

export interface AgentProjectScope {
  projectId: string
  maxRole: DelegatedAgentRole
}

export interface AgentSession {
  id: string
  userId: string
  agentName: string
  description?: string
  tokenHash: string // SHA-256 of the plain Bearer token
  tokenPrefix: string // First 12 chars for audit (e.g. "md4lp_agt_")
  projectScopes: AgentProjectScope[] // Explicit allowed projects with max roles
  createdAt: number
  lastUsedAt: number
  idleTimeoutMs: number // Default 24h (86_400_000)
  absoluteExpiresAt: number // Default 7d (createdAt + 7 * 86_400_000)
  status: 'active' | 'revoked'
}

export interface PendingAgentGrant {
  code: string // 60-second one-time code
  userId: string
  agentName: string
  description?: string
  codeChallenge: string // SHA-256 base64url PKCE challenge
  projectScopes: AgentProjectScope[]
  expiresAt: number // now + 60_000 (60s)
  createdAt: number
}
