import { describe, it, expect, beforeEach } from 'vitest'
import { AuthService, MemoryAuthStore, EmailOutbox } from '../src/auth'

describe('AuthService, Multi-Email Identity & Usernames', () => {
  let auth: AuthService
  let store: MemoryAuthStore
  let outbox: EmailOutbox

  beforeEach(() => {
    store = new MemoryAuthStore()
    outbox = new EmailOutbox()
    auth = new AuthService(store, outbox)
  })

  describe('Verification Codes (OTP)', () => {
    it('generates a 6-digit code, stores it as a hash with salt, and sends email to outbox', async () => {
      const res = await auth.requestCode({
        identifier: 'alice@example.com',
        purpose: 'login',
        name: 'Alice',
      })

      expect(res.ok).toBe(true)
      expect(res.email).toBe('alice@example.com')
      expect(res.expiresInSeconds).toBeGreaterThan(500)

      const emails = await outbox.getEmails('alice@example.com')
      expect(emails).toHaveLength(1)
      expect(emails[0]!.code).toMatch(/^\d{6}$/)
      expect(emails[0]!.subject).toContain(emails[0]!.code)

      // Verify that the code is NOT stored in plain text in the store
      const internalCodes = (store as any).verificationCodes
      const record = [...internalCodes.values()][0]
      expect(record.codeHash).toBeDefined()
      expect(record.codeHash).not.toBe(emails[0]!.code)
      expect(record.salt).toBeDefined()
      expect(record.attemptsLeft).toBe(5)
      expect(record.consumedAt).toBeNull()
    })

    it('successfully verifies code, marks consumed at, and creates user with unique username and primary email', async () => {
      await auth.requestCode({ identifier: 'bob@example.com', purpose: 'login', name: 'Bob Builder' })
      const code = (await outbox.getLatestCode('bob@example.com'))!

      const result = await auth.verifyCodeAndLogin({
        identifier: 'bob@example.com',
        purpose: 'login',
        code,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.token).toBeDefined()
      expect(result.user.name).toBe('Bob Builder')
      expect(result.user.username).toBe('bob')
      expect(result.user.defaultEmail).toBe('bob@example.com')
      expect(result.user.emails).toHaveLength(1)
      expect(result.user.emails[0]!.email).toBe('bob@example.com')
      expect(result.user.emails[0]!.isPrimary).toBe(true)
      expect(result.user.emails[0]!.verifiedAt).toBeTypeOf('number')

      // Check atomic consumption: second attempt fails with already_consumed
      const replay = await auth.verifyCodeAndLogin({
        identifier: 'bob@example.com',
        purpose: 'login',
        code,
      })
      expect(replay.ok).toBe(false)
      if (!replay.ok) {
        expect(replay.error).toContain('already been used')
      }
    })

    it('allows logging in using username (with or without @), sending OTP to primary email, and rejects unknown usernames', async () => {
      // 1. Initial register with email
      await auth.requestCode({ identifier: 'carol@example.com', purpose: 'login', name: 'Carol' })
      const regCode = (await outbox.getLatestCode('carol@example.com'))!
      const userRes = await auth.verifyCodeAndLogin({ identifier: 'carol@example.com', code: regCode })
      if (!userRes.ok) return
      expect(userRes.user.username).toBe('carol')

      // 2. Request code using username with leading '@' ('@carol')
      const loginReq1 = await auth.requestCode({ identifier: '@carol', purpose: 'login' })
      expect(loginReq1.ok).toBe(true)
      expect(loginReq1.email).toBe('carol@example.com')
      expect(loginReq1.isUsernameLogin).toBe(true)

      const loginCode1 = (await outbox.getLatestCode('carol@example.com'))!
      expect(loginCode1).toBeDefined()

      // Verify code using '@carol'
      const loginRes1 = await auth.verifyCodeAndLogin({ identifier: '@carol', code: loginCode1 })
      expect(loginRes1.ok).toBe(true)
      if (!loginRes1.ok) return
      expect(loginRes1.user.id).toBe(userRes.user.id)

      // 3. Request code using username without '@' ('carol')
      const loginReq2 = await auth.requestCode({ identifier: 'carol', purpose: 'login' })
      expect(loginReq2.ok).toBe(true)
      expect(loginReq2.email).toBe('carol@example.com')
      const loginCode2 = (await outbox.getLatestCode('carol@example.com'))!

      const loginRes2 = await auth.verifyCodeAndLogin({ identifier: 'carol', code: loginCode2 })
      expect(loginRes2.ok).toBe(true)

      // 4. Non-existent username (e.g. '@unknown') is rejected with informative message
      await expect(
        auth.requestCode({ identifier: '@unknown_user', purpose: 'login' }),
      ).rejects.toThrow('No user found with username "@unknown_user"')
    })

    it('rejects verification if purpose does not match (operation binding)', async () => {
      await auth.requestCode({ identifier: 'dave@example.com', purpose: 'login' })
      const code = (await outbox.getLatestCode('dave@example.com'))!

      // Try to verify with purpose 'add_email' instead of 'login'
      const result = await auth.verifyCodeAndLogin({
        identifier: 'dave@example.com',
        purpose: 'add_email',
        code,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('No active verification code')
      }
    })

    it('enforces maximum attempt limits (decrements on failure and locks when exhausted)', async () => {
      await auth.requestCode({ identifier: 'eve@example.com', purpose: 'login' })
      const realCode = (await outbox.getLatestCode('eve@example.com'))!

      // Try wrong codes 4 times
      for (let i = 4; i >= 1; i--) {
        const attempt = await auth.verifyCodeAndLogin({
          identifier: 'eve@example.com',
          purpose: 'login',
          code: '000000',
        })
        expect(attempt.ok).toBe(false)
        if (!attempt.ok) {
          expect(attempt.attemptsLeft).toBe(i)
        }
      }

      // 5th wrong attempt exhausts all attempts
      const exhausted = await auth.verifyCodeAndLogin({
        identifier: 'eve@example.com',
        purpose: 'login',
        code: '000000',
      })
      expect(exhausted.ok).toBe(false)
      if (!exhausted.ok) {
        expect(exhausted.error).toContain('Maximum verification attempts exceeded')
        expect(exhausted.attemptsLeft).toBe(0)
      }

      // Even with the correct code, it remains rejected once exhausted
      const retryReal = await auth.verifyCodeAndLogin({
        identifier: 'eve@example.com',
        purpose: 'login',
        code: realCode,
      })
      expect(retryReal.ok).toBe(false)
      if (!retryReal.ok) {
        expect(retryReal.error).toContain('Maximum verification attempts exceeded')
      }
    })

    it('rejects expired codes', async () => {
      // Create code with -1 ms expiration
      await (store as any).createVerificationCode('frank@example.com', 'login', {}, -1000)

      const result = await auth.verifyCodeAndLogin({
        identifier: 'frank@example.com',
        purpose: 'login',
        code: '123456',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('expired')
      }
    })
  })

  describe('Multi-Email User Account Management & Pending Emails', () => {
    it('stores secondary email as unverified immediately, allows verifying later, setting primary, and removing', async () => {
      // 1. Initial signup
      await auth.requestCode({ identifier: 'frank@work.com', purpose: 'login', name: 'Frank' })
      const code1 = (await outbox.getLatestCode('frank@work.com'))!
      const loginRes = await auth.verifyCodeAndLogin({ identifier: 'frank@work.com', purpose: 'login', code: code1 })
      expect(loginRes.ok).toBe(true)
      if (!loginRes.ok) return

      const userId = loginRes.user.id

      // 2. Request adding a personal email -> immediately attached as unverified/pending
      const addReq = await auth.requestAddEmail({ userId, newEmail: 'frank@personal.com' })
      expect(addReq.ok).toBe(true)
      expect(addReq.emailRecord.verifiedAt).toBeNull()

      // Verify that user profile immediately shows the unverified email
      const profileMidway = await auth.getUserProfile(userId)
      expect(profileMidway?.emails).toHaveLength(2)
      const pendingEmail = profileMidway?.emails.find((e) => e.email === 'frank@personal.com')
      expect(pendingEmail).toBeDefined()
      expect(pendingEmail?.verifiedAt).toBeNull()

      // 3. Verify secondary email later with code
      const code2 = (await outbox.getLatestCode('frank@personal.com', 'add_email'))!
      const addRes = await auth.verifyAddEmail({ userId, newEmail: 'frank@personal.com', code: code2 })
      expect(addRes.ok).toBe(true)
      if (!addRes.ok) return

      expect(addRes.user.emails).toHaveLength(2)
      expect(addRes.user.emails.find((e) => e.email === 'frank@personal.com')?.verifiedAt).toBeTypeOf('number')

      // 4. Change primary email to personal.com
      const setPrim = await auth.setPrimaryEmail(userId, 'frank@personal.com')
      expect(setPrim.ok).toBe(true)

      const updatedUser = await auth.getUserProfile(userId)
      expect(updatedUser?.defaultEmail).toBe('frank@personal.com')
      expect(updatedUser?.emails.find((e) => e.email === 'frank@personal.com')?.isPrimary).toBe(true)
      expect(updatedUser?.emails.find((e) => e.email === 'frank@work.com')?.isPrimary).toBe(false)

      // 5. Try to remove primary email (should fail)
      const delPrim = await auth.removeEmail(userId, 'frank@personal.com')
      expect(delPrim.ok).toBe(false)

      // 6. Remove secondary email (work.com)
      const delSec = await auth.removeEmail(userId, 'frank@work.com')
      expect(delSec.ok).toBe(true)

      const finalUser = await auth.getUserProfile(userId)
      expect(finalUser?.emails).toHaveLength(1)
      expect(finalUser?.defaultEmail).toBe('frank@personal.com')

      // 7. Try to remove the only remaining email (should fail)
      const delLast = await auth.removeEmail(userId, 'frank@personal.com')
      expect(delLast.ok).toBe(false)
    })

    it('allows verified email transfer to new owner, promotes remaining emails to primary, and suspends accounts with 0 emails', async () => {
      // User 1 registers with primary work email and secondary personal email
      await auth.requestCode({ identifier: 'user1.work@corp.com', purpose: 'login', name: 'User 1' })
      const c1 = (await outbox.getLatestCode('user1.work@corp.com'))!
      const u1 = await auth.verifyCodeAndLogin({ identifier: 'user1.work@corp.com', code: c1 })
      if (!u1.ok) return

      await auth.requestAddEmail({ userId: u1.user.id, newEmail: 'user1.personal@gmail.com' })
      const c1Sec = (await outbox.getLatestCode('user1.personal@gmail.com', 'add_email'))!
      await auth.verifyAddEmail({ userId: u1.user.id, newEmail: 'user1.personal@gmail.com', code: c1Sec })

      const u1Profile = await auth.getUserProfile(u1.user.id)
      expect(u1Profile?.emails).toHaveLength(2)
      expect(u1Profile?.defaultEmail).toBe('user1.work@corp.com')

      // User 2 registers with their own primary email
      await auth.requestCode({ identifier: 'user2.main@corp.com', purpose: 'login', name: 'User 2' })
      const c2 = (await outbox.getLatestCode('user2.main@corp.com'))!
      const u2 = await auth.verifyCodeAndLogin({ identifier: 'user2.main@corp.com', code: c2 })
      expect(u2.ok).toBe(true)
      if (!u2.ok) return

      // User 2 claims and verifies user1.work@corp.com (e.g. employee departure / mailbox recycled)
      await auth.requestAddEmail({ userId: u2.user.id, newEmail: 'user1.work@corp.com' })
      const c2Work = (await outbox.getLatestCode('user1.work@corp.com', 'add_email'))!
      const u2AddWork = await auth.verifyAddEmail({ userId: u2.user.id, newEmail: 'user1.work@corp.com', code: c2Work })
      expect(u2AddWork.ok).toBe(true)

      // User 2 now has user1.work@corp.com associated
      const u2Profile = await auth.getUserProfile(u2.user.id)
      expect(u2Profile?.emails.some((e) => e.email === 'user1.work@corp.com' && e.verifiedAt !== null)).toBe(true)

      // User 1 automatically had user1.work@corp.com unlinked, and personal@gmail.com promoted to primary
      const u1AfterFirstTransfer = await auth.getUserProfile(u1.user.id)
      expect(u1AfterFirstTransfer?.emails).toHaveLength(1)
      expect(u1AfterFirstTransfer?.defaultEmail).toBe('user1.personal@gmail.com')
      expect(u1AfterFirstTransfer?.status).toBe('active')

      // User 1 can still login with username and receives OTP on personal@gmail.com
      const u1LoginReq = await auth.requestCode({ identifier: u1.user.username })
      expect(u1LoginReq.email).toBe('user1.personal@gmail.com')

      // User 2 now also claims and verifies user1.personal@gmail.com
      await auth.requestAddEmail({ userId: u2.user.id, newEmail: 'user1.personal@gmail.com' })
      const c2Sec = (await outbox.getLatestCode('user1.personal@gmail.com', 'add_email'))!
      await auth.verifyAddEmail({ userId: u2.user.id, newEmail: 'user1.personal@gmail.com', code: c2Sec })

      // User 1 now has 0 verified emails left -> account status is suspended
      const u1Orphaned = await auth.getUserProfile(u1.user.id)
      expect(u1Orphaned?.emails).toHaveLength(0)
      expect(u1Orphaned?.defaultEmail).toBe('')
      expect(u1Orphaned?.status).toBe('suspended')

      // User 1 attempting to login with username is rejected with suspended message
      await expect(
        auth.requestCode({ identifier: u1.user.username }),
      ).rejects.toThrow('Account "@user1.work" is suspended because it has no active email address.')
    })

    it('transfers email ownership to a brand new username when registering with an existing email', async () => {
      // 1. User A registers with email a@b.com and username @user_a
      await auth.requestCode({ identifier: 'a@b.com', username: 'user_a', name: 'User A' })
      const codeA = (await outbox.getLatestCode('a@b.com'))!
      const userA = await auth.verifyCodeAndLogin({ identifier: 'a@b.com', code: codeA, username: 'user_a' })
      expect(userA.ok).toBe(true)
      if (!userA.ok) return
      expect(userA.user.username).toBe('user_a')

      // 2. User B tries to register with a new username @juanyque, and inputs email a@b.com
      const reqB = await auth.requestCode({
        identifier: 'a@b.com',
        username: 'juanyque',
        name: 'Juan Garcia',
      })
      expect(reqB.ok).toBe(true)
      const codeB = (await outbox.getLatestCode('a@b.com'))!

      // 3. User B verifies the code with username: 'juanyque'
      const userB = await auth.verifyCodeAndLogin({
        identifier: 'a@b.com',
        code: codeB,
        username: 'juanyque',
        name: 'Juan Garcia',
      })
      expect(userB.ok).toBe(true)
      if (!userB.ok) return
      expect(userB.user.username).toBe('juanyque')
      expect(userB.user.defaultEmail).toBe('a@b.com')

      // 4. User A's account has 0 emails left and is suspended
      const profileA = await auth.getUserProfile(userA.user.id)
      expect(profileA?.emails).toHaveLength(0)
      expect(profileA?.status).toBe('suspended')
    })

    it('supports updating user avatar and unique username', async () => {
      await auth.requestCode({ identifier: 'grace@example.com', purpose: 'login', name: 'Grace Hopper' })
      const code = (await outbox.getLatestCode('grace@example.com'))!
      const res = await auth.verifyCodeAndLogin({ identifier: 'grace@example.com', code })
      if (!res.ok) return

      const updateRes = await auth.updateProfile(res.user.id, {
        username: 'grace_hopper',
        avatarUrl: 'https://example.com/avatar.png',
        name: 'Admiral Grace',
      })

      expect(updateRes.ok).toBe(true)
      if (!updateRes.ok) return
      expect(updateRes.user.username).toBe('grace_hopper')
      expect(updateRes.user.avatarUrl).toBe('https://example.com/avatar.png')
      expect(updateRes.user.name).toBe('Admiral Grace')
    })
  })
})
