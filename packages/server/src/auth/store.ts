import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import type { Session, User, UserEmail, UserWithEmails, VerificationCodeRecord } from './types'

export interface CreateUserOptions {
  name: string
  username?: string
  primaryEmail: string
  avatarUrl?: string
}

export interface UpdateProfileOptions {
  name?: string
  username?: string
  avatarUrl?: string
}

export interface AuthStore {
  createUser(options: CreateUserOptions): Promise<UserWithEmails>
  getUser(userId: string): Promise<User | null>
  getUserWithEmails(userId: string): Promise<UserWithEmails | null>
  getUserByEmail(email: string): Promise<{ user: User; email: UserEmail } | null>
  getVerifiedUserByEmail(email: string): Promise<{ user: User; email: UserEmail } | null>
  getUserByUsername(username: string): Promise<User | null>
  isUsernameAvailable(username: string): Promise<boolean>
  getUserByIdentifier(identifier: string): Promise<{ user: User; email: UserEmail } | null>
  getUserEmails(userId: string): Promise<UserEmail[]>
  addEmail(userId: string, email: string, verified?: boolean): Promise<UserEmail>
  setPrimaryEmail(userId: string, email: string): Promise<void>
  removeEmail(userId: string, email: string): Promise<void>
  markEmailVerified(email: string): Promise<void>
  updateProfile(userId: string, updates: UpdateProfileOptions): Promise<UserWithEmails>

  createVerificationCode(
    email: string,
    purpose: string,
    metadata?: Record<string, unknown>,
    expiresInMs?: number,
    maxAttempts?: number,
  ): Promise<{ id: string; code: string; expiresAt: number }>

  verifyCode(
    email: string,
    purpose: string,
    code: string,
  ): Promise<{
    success: boolean
    error?: 'invalid_code' | 'expired' | 'max_attempts_exceeded' | 'already_consumed' | 'not_found'
    metadata?: Record<string, unknown>
    attemptsLeft?: number
  }>

  createSession(userId: string, email: string, expiresInMs?: number): Promise<Session>
  getSession(token: string): Promise<Session | null>
  revokeSession(token: string): Promise<void>
}

function hashOtp(code: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex')
}

export function isEmailLike(input: string): boolean {
  const trimmed = input.trim()
  if (trimmed.startsWith('@')) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

export function normalizeUsername(input: string): string {
  return input
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
}

export class MemoryAuthStore implements AuthStore {
  private users = new Map<string, User>()
  private usernames = new Map<string, string>() // normalized username -> userId
  private userEmails = new Map<string, UserEmail[]>() // userId -> UserEmail[]
  private verificationCodes = new Map<string, VerificationCodeRecord>() // id -> VerificationCodeRecord
  private sessions = new Map<string, Session>() // token -> Session
  private codeSeq = 0

  async createUser(options: CreateUserOptions): Promise<UserWithEmails> {
    const normEmail = options.primaryEmail.trim().toLowerCase()
    if (!isEmailLike(normEmail)) {
      throw new Error(`Invalid email address: "${options.primaryEmail}"`)
    }

    const rawUsername = options.username || normEmail.split('@')[0] || 'user'
    let username = normalizeUsername(rawUsername)
    if (!username) username = `user_${randomInt(1000, 9999)}`

    // If username is taken, generate an available unique username
    if (this.usernames.has(username)) {
      if (options.username) {
        throw new Error(`Username ${username} is already taken`)
      }
      let suffix = 1
      while (this.usernames.has(`${username}${suffix}`)) {
        suffix++
      }
      username = `${username}${suffix}`
    }

    const userId = randomUUID()
    const now = Date.now()
    const user: User = {
      id: userId,
      username,
      name: options.name.trim() || username,
      avatarUrl: options.avatarUrl?.trim() || undefined,
      createdAt: now,
    }

    const emailRecord: UserEmail = {
      email: normEmail,
      userId,
      verifiedAt: now,
      isPrimary: true,
      createdAt: now,
    }

    this.users.set(userId, user)
    this.usernames.set(username, userId)
    this.userEmails.set(userId, [emailRecord])

    this.transferVerifiedEmailFromOtherUsers(normEmail, userId)

    return {
      ...user,
      defaultEmail: normEmail,
      emails: [emailRecord],
    }
  }

  async getUser(userId: string): Promise<User | null> {
    const user = this.users.get(userId)
    return user ? { ...user } : null
  }

  async getUserWithEmails(userId: string): Promise<UserWithEmails | null> {
    const user = this.users.get(userId)
    if (!user) return null
    const emails = this.userEmails.get(userId) ?? []
    const verifiedEmails = emails.filter((e) => e.verifiedAt !== null)
    const primary = verifiedEmails.find((e) => e.isPrimary) ?? verifiedEmails[0] ?? emails[0]
    const status = verifiedEmails.length > 0 ? (user.status ?? 'active') : 'suspended'
    return {
      ...user,
      status,
      defaultEmail: primary?.verifiedAt ? primary.email : '',
      emails: emails.map((e) => ({ ...e })),
    }
  }

  async getUserByEmail(email: string): Promise<{ user: User; email: UserEmail } | null> {
    const normEmail = email.trim().toLowerCase()
    for (const [userId, emails] of this.userEmails.entries()) {
      const match = emails.find((e) => e.email === normEmail)
      if (match) {
        const user = this.users.get(userId)
        if (user) {
          return { user: { ...user }, email: { ...match } }
        }
      }
    }
    return null
  }

  async getVerifiedUserByEmail(email: string): Promise<{ user: User; email: UserEmail } | null> {
    const normEmail = email.trim().toLowerCase()
    for (const [userId, emails] of this.userEmails.entries()) {
      const match = emails.find((e) => e.email === normEmail && e.verifiedAt !== null)
      if (match) {
        const user = this.users.get(userId)
        if (user) {
          return { user: { ...user }, email: { ...match } }
        }
      }
    }
    return null
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const norm = normalizeUsername(username)
    const userId = this.usernames.get(norm)
    if (!userId) return null
    const user = this.users.get(userId)
    return user ? { ...user } : null
  }

  async isUsernameAvailable(username: string): Promise<boolean> {
    const norm = normalizeUsername(username)
    if (!norm) return false
    return !this.usernames.has(norm)
  }

  async getUserByIdentifier(identifier: string): Promise<{ user: User; email: UserEmail } | null> {
    const trimmed = identifier.trim().toLowerCase()
    if (trimmed.includes('@')) {
      return this.getVerifiedUserByEmail(trimmed)
    }

    const user = await this.getUserByUsername(trimmed)
    if (!user || user.status === 'suspended') return null
    const emails = this.userEmails.get(user.id) ?? []
    const primary = emails.find((e) => e.isPrimary && e.verifiedAt !== null) ?? emails.find((e) => e.verifiedAt !== null)
    if (!primary) return null
    return { user, email: primary }
  }

  async getUserEmails(userId: string): Promise<UserEmail[]> {
    const emails = this.userEmails.get(userId) ?? []
    return emails.map((e) => ({ ...e }))
  }

  async addEmail(userId: string, email: string, verified = false): Promise<UserEmail> {
    const normEmail = email.trim().toLowerCase()
    const emails = this.userEmails.get(userId) ?? []
    const existing = emails.find((e) => e.email === normEmail)

    if (existing) {
      if (verified && !existing.verifiedAt) {
        existing.verifiedAt = Date.now()
        this.transferVerifiedEmailFromOtherUsers(normEmail, userId)
        const user = this.users.get(userId)
        if (user && user.status === 'suspended') {
          user.status = 'active'
        }
      }
      return { ...existing }
    }

    const isFirst = emails.length === 0
    const now = Date.now()
    const emailRecord: UserEmail = {
      email: normEmail,
      userId,
      verifiedAt: verified ? now : null,
      isPrimary: isFirst,
      createdAt: now,
    }

    emails.push(emailRecord)
    this.userEmails.set(userId, emails)

    if (verified) {
      this.transferVerifiedEmailFromOtherUsers(normEmail, userId)
      const user = this.users.get(userId)
      if (user && user.status === 'suspended') {
        user.status = 'active'
      }
    }

    return { ...emailRecord }
  }

  private transferVerifiedEmailFromOtherUsers(email: string, verifiedUserId: string): void {
    const normEmail = email.trim().toLowerCase()
    for (const [userId, emails] of this.userEmails.entries()) {
      if (userId !== verifiedUserId) {
        const idx = emails.findIndex((e) => e.email === normEmail)
        if (idx !== -1) {
          emails.splice(idx, 1)

          // If the previous user has other verified emails, ensure there is a primary
          const remainingVerified = emails.filter((e) => e.verifiedAt !== null)
          if (remainingVerified.length > 0) {
            const hasPrimary = remainingVerified.some((e) => e.isPrimary)
            if (!hasPrimary) {
              remainingVerified[0]!.isPrimary = true
            }
          } else {
            // No verified emails left -> suspend user account
            const otherUser = this.users.get(userId)
            if (otherUser) {
              otherUser.status = 'suspended'
            }
          }
        }
      }
    }
  }

  async markEmailVerified(email: string): Promise<void> {
    const normEmail = email.trim().toLowerCase()
    let verifiedUserId = ''
    for (const [userId, emails] of this.userEmails.entries()) {
      const target = emails.find((e) => e.email === normEmail)
      if (target && !target.verifiedAt) {
        target.verifiedAt = Date.now()
        verifiedUserId = userId
        break
      }
    }
    if (verifiedUserId) {
      this.transferVerifiedEmailFromOtherUsers(normEmail, verifiedUserId)
      const user = this.users.get(verifiedUserId)
      if (user && user.status === 'suspended') {
        user.status = 'active'
      }
    }
  }

  async setPrimaryEmail(userId: string, email: string): Promise<void> {
    const normEmail = email.trim().toLowerCase()
    const emails = this.userEmails.get(userId)
    if (!emails) throw new Error('User has no registered emails')

    const target = emails.find((e) => e.email === normEmail)
    if (!target) throw new Error('Email not found for this user')
    if (!target.verifiedAt) throw new Error('Cannot set unverified email as primary')

    for (const e of emails) {
      e.isPrimary = e.email === normEmail
    }
  }

  async removeEmail(userId: string, email: string): Promise<void> {
    const normEmail = email.trim().toLowerCase()
    const emails = this.userEmails.get(userId)
    if (!emails) throw new Error('User has no registered emails')

    const index = emails.findIndex((e) => e.email === normEmail)
    if (index === -1) throw new Error('Email not found for this user')

    if (emails.length === 1) {
      throw new Error('Cannot remove the only email on the account')
    }

    const emailToRemove = emails[index]
    if (!emailToRemove) throw new Error('Email not found for this user')

    if (emailToRemove.isPrimary) {
      throw new Error('Cannot remove primary email. Set another verified email as primary first.')
    }

    emails.splice(index, 1)
  }

  async updateProfile(userId: string, updates: UpdateProfileOptions): Promise<UserWithEmails> {
    const user = this.users.get(userId)
    if (!user) throw new Error('User not found')

    if (updates.username !== undefined) {
      const newUsername = normalizeUsername(updates.username)
      if (!newUsername) throw new Error('Username cannot be empty')
      if (newUsername !== user.username) {
        if (this.usernames.has(newUsername)) {
          throw new Error(`Username ${newUsername} is already taken`)
        }
        this.usernames.delete(user.username)
        this.usernames.set(newUsername, userId)
        user.username = newUsername
      }
    }

    if (updates.name !== undefined) {
      const trimmedName = updates.name.trim()
      if (trimmedName) user.name = trimmedName
    }

    if (updates.avatarUrl !== undefined) {
      user.avatarUrl = updates.avatarUrl.trim() || undefined
    }

    const full = await this.getUserWithEmails(userId)
    if (!full) throw new Error('User not found after update')
    return full
  }

  async createVerificationCode(
    email: string,
    purpose: string,
    metadata?: Record<string, unknown>,
    expiresInMs = 10 * 60 * 1000, // 10 minutes
    maxAttempts = 5,
  ): Promise<{ id: string; code: string; expiresAt: number }> {
    const normEmail = email.trim().toLowerCase()
    const id = randomUUID()
    const codeNum = randomInt(100000, 999999) // 6-digit numeric OTP
    const code = String(codeNum)
    const salt = randomBytes(16).toString('hex')
    const codeHash = hashOtp(code, salt)
    const now = Date.now()
    const expiresAt = now + expiresInMs

    const record: VerificationCodeRecord = {
      id,
      email: normEmail,
      purpose,
      codeHash,
      salt,
      expiresAt,
      attemptsLeft: maxAttempts,
      consumedAt: null,
      metadata,
      createdAt: now,
      seq: ++this.codeSeq,
    }

    this.verificationCodes.set(id, record)
    return { id, code, expiresAt }
  }

  async verifyCode(
    email: string,
    purpose: string,
    code: string,
  ): Promise<{
    success: boolean
    error?: 'invalid_code' | 'expired' | 'max_attempts_exceeded' | 'already_consumed' | 'not_found'
    metadata?: Record<string, unknown>
    attemptsLeft?: number
  }> {
    const normEmail = email.trim().toLowerCase()
    const trimmedCode = code.trim()

    // Find the latest valid/active verification code for this email and purpose
    const candidates = [...this.verificationCodes.values()]
      .filter((r) => r.email === normEmail && r.purpose === purpose)
      .sort((a, b) => (b.createdAt - a.createdAt) || ((b.seq ?? 0) - (a.seq ?? 0)))

    const latest = candidates[0]
    if (!latest) {
      return { success: false, error: 'not_found' }
    }
    const now = Date.now()

    if (latest.consumedAt !== null) {
      return { success: false, error: 'already_consumed' }
    }

    if (now > latest.expiresAt) {
      return { success: false, error: 'expired' }
    }

    if (latest.attemptsLeft <= 0) {
      return { success: false, error: 'max_attempts_exceeded', attemptsLeft: 0 }
    }

    const expectedHash = hashOtp(trimmedCode, latest.salt)
    if (expectedHash !== latest.codeHash) {
      latest.attemptsLeft -= 1
      if (latest.attemptsLeft <= 0) {
        return { success: false, error: 'max_attempts_exceeded', attemptsLeft: 0 }
      }
      return { success: false, error: 'invalid_code', attemptsLeft: latest.attemptsLeft }
    }

    // Atomic consumption
    latest.consumedAt = now
    return { success: true, metadata: latest.metadata }
  }

  async createSession(userId: string, email: string, expiresInMs = 30 * 24 * 60 * 60 * 1000): Promise<Session> {
    const token = randomBytes(32).toString('base64url')
    const now = Date.now()
    const session: Session = {
      token,
      userId,
      email: email.trim().toLowerCase(),
      expiresAt: now + expiresInMs,
      createdAt: now,
    }
    this.sessions.set(token, session)
    return { ...session }
  }

  async getSession(token: string): Promise<Session | null> {
    const session = this.sessions.get(token)
    if (!session) return null
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token)
      return null
    }
    return { ...session }
  }

  async revokeSession(token: string): Promise<void> {
    this.sessions.delete(token)
  }
}
