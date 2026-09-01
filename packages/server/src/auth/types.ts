export type VerificationPurpose =
  | 'login'
  | 'register'
  | 'add_email'
  | 'reverify'
  | 'join_domain_team'
  | 'expel_member'

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
