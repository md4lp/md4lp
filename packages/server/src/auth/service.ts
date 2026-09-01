import { EmailOutbox } from './outbox'
import { MemoryAuthStore, isEmailLike, normalizeUsername, type AuthStore, type UpdateProfileOptions } from './store'
import type { Session, UserEmail, UserWithEmails, VerificationPurpose } from './types'

export class AuthService {
  constructor(
    public readonly store: AuthStore = new MemoryAuthStore(),
    public readonly outbox: EmailOutbox = new EmailOutbox(),
  ) {}

  async lookupIdentifier(raw: string): Promise<{
    exists: boolean
    isEmail: boolean
    cleanIdentifier: string
    targetEmail?: string
    username?: string
    name?: string
  }> {
    const trimmed = raw.trim()
    if (isEmailLike(trimmed)) {
      const normEmail = trimmed.toLowerCase()
      const existing = await this.store.getVerifiedUserByEmail(normEmail)
      if (existing) {
        return {
          exists: true,
          isEmail: true,
          cleanIdentifier: normEmail,
          targetEmail: normEmail,
          username: existing.user.username,
          name: existing.user.name,
        }
      }
      return { exists: false, isEmail: true, cleanIdentifier: normEmail }
    } else {
      const cleanUsername = normalizeUsername(trimmed)
      if (!cleanUsername) {
        throw new Error('Please enter a valid username or email address')
      }
      const existingUser = await this.store.getUserByUsername(cleanUsername)
      if (existingUser) {
        const full = await this.store.getUserWithEmails(existingUser.id)
        return {
          exists: true,
          isEmail: false,
          cleanIdentifier: cleanUsername,
          targetEmail: full?.defaultEmail,
          username: existingUser.username,
          name: existingUser.name,
        }
      }
      return { exists: false, isEmail: false, cleanIdentifier: cleanUsername }
    }
  }

  async checkUsernameAvailability(raw: string): Promise<{ available: boolean; normalized: string; error?: string }> {
    const normalized = normalizeUsername(raw)
    if (!normalized || normalized.length < 2) {
      return { available: false, normalized, error: 'Username must be at least 2 characters long' }
    }
    const available = await this.store.isUsernameAvailable(normalized)
    return {
      available,
      normalized,
      error: available ? undefined : `Username "@${normalized}" is already taken. Please choose another.`,
    }
  }

  async requestCode(options: {
    identifier: string
    purpose?: VerificationPurpose | string
    name?: string
    username?: string
    metadata?: Record<string, unknown>
  }): Promise<{
    ok: boolean
    email: string
    expiresInSeconds: number
    devCode?: string
    isUsernameLogin?: boolean
    isNewUser?: boolean
  }> {
    const raw = options.identifier.trim()
    if (!raw) {
      throw new Error('Email or username is required')
    }

    let targetEmail: string
    let isUsernameLogin = false
    let isNewUser = false
    let requestedUsername = options.username ? normalizeUsername(options.username) : undefined
    const purpose = options.purpose ?? 'login'

    if (isEmailLike(raw)) {
      targetEmail = raw.toLowerCase()
      const existing = await this.store.getVerifiedUserByEmail(targetEmail)
      if (!existing) {
        isNewUser = true
        if (requestedUsername) {
          const available = await this.store.isUsernameAvailable(requestedUsername)
          if (!available) {
            throw new Error(`Username "@${requestedUsername}" is already taken. Please select another.`)
          }
        }
      }
    } else {
      // Login via username (with or without @) -> resolve primary email
      const cleanUsername = normalizeUsername(raw)
      if (!cleanUsername) {
        throw new Error('Please enter a valid email address or username')
      }
      const user = await this.store.getUserByUsername(cleanUsername)
      if (!user) {
        // User tried to register with a username -> check if email is provided in metadata
        const metaEmail = options.metadata?.email ? String(options.metadata.email).trim().toLowerCase() : undefined
        if (metaEmail && isEmailLike(metaEmail)) {
          targetEmail = metaEmail
          requestedUsername = cleanUsername
          isNewUser = true
          const available = await this.store.isUsernameAvailable(cleanUsername)
          if (!available) {
            throw new Error(`Username "@${cleanUsername}" is already taken. Please select another.`)
          }
        } else {
          throw new Error(`No user found with username "@${cleanUsername}". If you are signing up for the first time, please use your email address (e.g. you@company.com).`)
        }
      } else {
        if (user.status === 'suspended') {
          throw new Error(`Account "@${cleanUsername}" is suspended because it has no active email address.`)
        }
        const full = await this.store.getUserWithEmails(user.id)
        if (!full || !full.defaultEmail) {
          throw new Error(`Account "@${cleanUsername}" has no active verified email address to receive access codes.`)
        }
        targetEmail = full.defaultEmail
        isUsernameLogin = true
      }
    }

    const { code, expiresAt } = await this.store.createVerificationCode(
      targetEmail,
      purpose,
      {
        ...options.metadata,
        name: options.name,
        username: requestedUsername,
        requestedIdentifier: raw,
      },
      10 * 60 * 1000, // 10 minutes
      5, // 5 attempts
    )

    await this.outbox.sendVerificationCode(targetEmail, code, purpose)

    const expiresInSeconds = Math.round((expiresAt - Date.now()) / 1000)
    return {
      ok: true,
      email: targetEmail,
      expiresInSeconds,
      devCode: process.env.NODE_ENV !== 'production' ? code : undefined,
      isUsernameLogin,
      isNewUser,
    }
  }

  async verifyCodeAndLogin(options: {
    identifier: string
    code: string
    purpose?: VerificationPurpose | string
    name?: string
    username?: string
  }): Promise<
    | { ok: true; token: string; user: UserWithEmails; session: Session }
    | { ok: false; error: string; attemptsLeft?: number }
  > {
    const raw = options.identifier.trim()
    const purpose = options.purpose ?? 'login'

    let targetEmail: string
    if (isEmailLike(raw)) {
      targetEmail = raw.toLowerCase()
    } else {
      const cleanUsername = normalizeUsername(raw)
      const user = await this.store.getUserByUsername(cleanUsername)
      if (!user) {
        return { ok: false, error: `No user found with username "@${cleanUsername}"` }
      }
      if (user.status === 'suspended') {
        return { ok: false, error: `Account "@${cleanUsername}" is suspended: no active verified email address.` }
      }
      const full = await this.store.getUserWithEmails(user.id)
      if (!full || !full.defaultEmail) {
        return { ok: false, error: 'User has no registered email' }
      }
      targetEmail = full.defaultEmail
    }

    const verification = await this.store.verifyCode(targetEmail, purpose, options.code)

    if (!verification.success) {
      const errorMap: Record<string, string> = {
        invalid_code: 'Invalid verification code',
        expired: 'Verification code has expired. Please request a new one.',
        max_attempts_exceeded: 'Maximum verification attempts exceeded. Please request a new code.',
        already_consumed: 'Verification code has already been used.',
        not_found: 'No active verification code found for this email.',
      }
      return {
        ok: false,
        error: errorMap[verification.error ?? ''] ?? 'Verification failed',
        attemptsLeft: verification.attemptsLeft,
      }
    }

    // Check if user already exists with this email as VERIFIED
    const chosenUsername = options.username ?? (verification.metadata?.username as string | undefined)
    const verifiedOwner = await this.store.getVerifiedUserByEmail(targetEmail)
    let user: UserWithEmails

    if (chosenUsername && (!verifiedOwner || normalizeUsername(verifiedOwner.user.username) !== normalizeUsername(chosenUsername))) {
      // User registered with a new chosen username and verified this email -> create new user and transfer email ownership
      const name = options.name ?? (verification.metadata?.name as string | undefined) ?? targetEmail.split('@')[0] ?? 'User'
      user = await this.store.createUser({
        name,
        username: chosenUsername,
        primaryEmail: targetEmail,
      })
    } else if (!verifiedOwner) {
      const anyUser = await this.store.getUserByEmail(targetEmail)
      if (anyUser) {
        await this.store.markEmailVerified(targetEmail)
        const full = await this.store.getUserWithEmails(anyUser.user.id)
        if (!full) throw new Error('User not found after verification')
        user = full
      } else {
        const name = options.name ?? (verification.metadata?.name as string | undefined) ?? targetEmail.split('@')[0] ?? 'User'
        user = await this.store.createUser({
          name,
          username: chosenUsername,
          primaryEmail: targetEmail,
        })
      }
    } else {
      await this.store.markEmailVerified(targetEmail)
      const full = await this.store.getUserWithEmails(verifiedOwner.user.id)
      if (!full) throw new Error('User not found after verification')
      user = full
    }

    const session = await this.store.createSession(user.id, targetEmail)

    return {
      ok: true,
      token: session.token,
      user,
      session,
    }
  }

  async requestAddEmail(options: {
    userId: string
    newEmail: string
  }): Promise<{ ok: boolean; email: string; emailRecord: UserEmail; expiresInSeconds: number; devCode?: string }> {
    const normEmail = options.newEmail.trim().toLowerCase()
    if (!normEmail || !normEmail.includes('@')) {
      throw new Error('Valid email address is required')
    }

    // Immediately associate email as pending (verified: false) so user can see it and verify later
    const emailRecord = await this.store.addEmail(options.userId, normEmail, false)

    const { code, expiresAt } = await this.store.createVerificationCode(
      normEmail,
      'add_email',
      { userId: options.userId },
      10 * 60 * 1000,
      5,
    )

    await this.outbox.sendVerificationCode(normEmail, code, 'add_email')

    return {
      ok: true,
      email: normEmail,
      emailRecord,
      expiresInSeconds: Math.round((expiresAt - Date.now()) / 1000),
      devCode: process.env.NODE_ENV !== 'production' ? code : undefined,
    }
  }

  async verifyAddEmail(options: {
    userId: string
    newEmail: string
    code: string
  }): Promise<
    | { ok: true; email: UserEmail; user: UserWithEmails }
    | { ok: false; error: string; attemptsLeft?: number }
  > {
    const normEmail = options.newEmail.trim().toLowerCase()
    const verification = await this.store.verifyCode(normEmail, 'add_email', options.code)

    if (!verification.success) {
      const errorMap: Record<string, string> = {
        invalid_code: 'Invalid verification code',
        expired: 'Verification code has expired. Please request a new one.',
        max_attempts_exceeded: 'Maximum verification attempts exceeded. Please request a new code.',
        already_consumed: 'Verification code has already been used.',
        not_found: 'No active verification code found for this email.',
      }
      return {
        ok: false,
        error: errorMap[verification.error ?? ''] ?? 'Verification failed',
        attemptsLeft: verification.attemptsLeft,
      }
    }

    const boundUserId = verification.metadata?.userId as string | undefined
    if (boundUserId && boundUserId !== options.userId) {
      return { ok: false, error: 'Verification code was requested for a different user' }
    }

    const emailRecord = await this.store.addEmail(options.userId, normEmail, true)
    const user = await this.store.getUserWithEmails(options.userId)
    if (!user) throw new Error('User not found')

    return {
      ok: true,
      email: emailRecord,
      user,
    }
  }

  async setPrimaryEmail(userId: string, email: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.store.setPrimaryEmail(userId, email)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async removeEmail(userId: string, email: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.store.removeEmail(userId, email)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async updateProfile(userId: string, updates: UpdateProfileOptions): Promise<{ ok: true; user: UserWithEmails } | { ok: false; error: string }> {
    try {
      const user = await this.store.updateProfile(userId, updates)
      return { ok: true, user }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async getUserProfile(userId: string): Promise<UserWithEmails | null> {
    return this.store.getUserWithEmails(userId)
  }

  async authenticateToken(token: string): Promise<{ user: UserWithEmails; currentEmail: string; session: Session } | null> {
    const session = await this.store.getSession(token)
    if (!session) return null
    const user = await this.store.getUserWithEmails(session.userId)
    if (!user || user.status === 'suspended') return null
    return {
      user,
      currentEmail: session.email,
      session,
    }
  }

  async logout(token: string): Promise<void> {
    await this.store.revokeSession(token)
  }
}
