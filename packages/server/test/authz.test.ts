import { describe, it, expect } from 'vitest'
import { defineAbilityForUser, assertCan, ForbiddenError } from '../src/authz'
import type { UserProfile } from '../src/auth/types'
import type { Team, TeamInvitation } from '../src/teams/types'

describe('CASL Declarative Authorization Engine (@md4lp/server authz)', () => {
  const alice: UserProfile = {
    id: 'user-alice-1',
    name: 'Alice',
    username: 'alice',
    defaultEmail: 'alice@acme.corp',
    avatarUrl: undefined,
    status: 'active',
    createdAt: Date.now(),
    emails: [
      { email: 'alice@acme.corp', userId: 'user-alice-1', verifiedAt: Date.now(), isPrimary: true, createdAt: Date.now() },
      { email: 'alice@personal.me', userId: 'user-alice-1', verifiedAt: Date.now(), isPrimary: false, createdAt: Date.now() },
    ],
  }

  const bob: UserProfile = {
    id: 'user-bob-2',
    name: 'Bob',
    username: 'bob',
    defaultEmail: 'bob@other.org',
    avatarUrl: undefined,
    status: 'active',
    createdAt: Date.now(),
    emails: [
      { email: 'bob@other.org', userId: 'user-bob-2', verifiedAt: Date.now(), isPrimary: true, createdAt: Date.now() },
    ],
  }

  const suspendedUser: UserProfile = {
    ...bob,
    id: 'user-suspended-3',
    status: 'suspended',
  }

  describe('Anonymous & Suspended user restrictions', () => {
    it('denies all protected permissions for unauthenticated users', () => {
      const anonAbility = defineAbilityForUser(undefined)
      expect(anonAbility.can('create', 'Team')).toBe(false)
      expect(anonAbility.can('read', 'User')).toBe(false)
      expect(() => assertCan(anonAbility, 'create', 'Team')).toThrow(ForbiddenError)
    })

    it('denies all protected permissions for suspended users', () => {
      const suspendedAbility = defineAbilityForUser(suspendedUser)
      expect(suspendedAbility.can('create', 'Team')).toBe(false)
      expect(suspendedAbility.can('read', 'User')).toBe(false)
    })
  })

  describe('Team permissions (ABAC & RBAC)', () => {
    const privateTeam: Team & { members: Array<{ userId: string; role: 'admin' | 'member' }> } = {
      id: 'team-priv-1',
      name: 'Alpha Core',
      type: 'private',
      createdBy: 'user-alice-1',
      createdAt: Date.now(),
      members: [
        { userId: 'user-alice-1', role: 'admin' },
        { userId: 'user-bob-2', role: 'member' },
      ],
    }

    const domainTeam: Team & { members: Array<{ userId: string; role: 'member' }> } = {
      id: 'team-dom-1',
      name: 'acme.corp Team',
      type: 'domain',
      domain: 'acme.corp',
      createdBy: 'system',
      createdAt: Date.now(),
      members: [
        { userId: 'user-alice-1', role: 'member' },
      ],
    }

    it('allows members to read their private team, and blocks non-members', () => {
      const aliceAbility = defineAbilityForUser(alice)
      const bobAbility = defineAbilityForUser(bob)
      const strangerAbility = defineAbilityForUser({
        ...bob,
        id: 'user-stranger-99',
        username: 'stranger',
        emails: [{ email: 'stranger@nowhere.com', userId: 'user-stranger-99', verifiedAt: Date.now(), isPrimary: true, createdAt: Date.now() }],
      })

      expect(aliceAbility.can('read', privateTeam)).toBe(true)
      expect(bobAbility.can('read', privateTeam)).toBe(true)
      expect(strangerAbility.can('read', privateTeam)).toBe(false)
      expect(() => assertCan(strangerAbility, 'read', privateTeam)).toThrow(ForbiddenError)
    })

    it('enforces admin role for managing (inviting/removing) in private teams', () => {
      const aliceAbility = defineAbilityForUser(alice)
      const bobAbility = defineAbilityForUser(bob)

      // Alice is admin -> can manage
      expect(aliceAbility.can('manage', privateTeam)).toBe(true)
      // Bob is member -> cannot manage
      expect(bobAbility.can('manage', privateTeam)).toBe(false)
      expect(() => assertCan(bobAbility, 'manage', privateTeam)).toThrow(ForbiddenError)
    })

    it('allows domain team read access to users with verified domain email even before joining', () => {
      const aliceAbility = defineAbilityForUser(alice) // has verified alice@acme.corp
      const bobAbility = defineAbilityForUser(bob) // has verified bob@other.org

      expect(aliceAbility.can('read', domainTeam)).toBe(true)
      expect(bobAbility.can('read', domainTeam)).toBe(false)
    })
  })

  describe('Invitations permissions', () => {
    const invForBob: TeamInvitation = {
      id: 'inv-123',
      teamId: 'team-priv-1',
      invitedBy: 'user-alice-1',
      role: 'member',
      targetUsername: 'bob',
      targetEmail: undefined,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 86400000,
    }

    it('allows recipient to accept or reject pending invitations, and denies strangers', () => {
      const bobAbility = defineAbilityForUser(bob)
      const aliceAbility = defineAbilityForUser(alice)

      // Bob is the recipient
      expect(bobAbility.can('accept', invForBob)).toBe(true)
      expect(bobAbility.can('reject', invForBob)).toBe(true)

      // Alice (not the recipient) cannot accept or reject Bob's invitation
      expect(aliceAbility.can('accept', invForBob)).toBe(false)
      expect(aliceAbility.can('reject', invForBob)).toBe(false)
      expect(() => assertCan(aliceAbility, 'accept', invForBob)).toThrow(ForbiddenError)
    })
  })
})
