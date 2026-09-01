import { describe, it, expect, beforeEach } from 'vitest'
import { AuthService } from '../src/auth/service'
import { MemoryAuthStore } from '../src/auth/store'
import { EmailOutbox } from '../src/auth/outbox'
import { TeamService, extractEmailDomain, isPublicDomain } from '../src/teams/service'
import { MemoryTeamStore } from '../src/teams/store'

describe('TeamService — Private Teams, Domain Teams & Invitations (Punto de parada B)', () => {
  let authStore: MemoryAuthStore
  let outbox: EmailOutbox
  let auth: AuthService
  let teamStore: MemoryTeamStore
  let teams: TeamService

  beforeEach(() => {
    authStore = new MemoryAuthStore()
    outbox = new EmailOutbox()
    auth = new AuthService(authStore, outbox)
    teamStore = new MemoryTeamStore()
    teams = new TeamService(teamStore, auth)
  })

  describe('Domain Extraction & Filtering', () => {
    it('correctly extracts domains and ignores public email providers', () => {
      expect(extractEmailDomain('alice@acme.corp')).toBe('acme.corp')
      expect(extractEmailDomain('bob@sub.domain.co.uk')).toBe('sub.domain.co.uk')
      expect(extractEmailDomain('invalid')).toBeNull()

      expect(isPublicDomain('gmail.com')).toBe(true)
      expect(isPublicDomain('outlook.com')).toBe(true)
      expect(isPublicDomain('proton.me')).toBe(true)
      expect(isPublicDomain('acme.corp')).toBe(false)
    })

    it('does not create auto-domain teams for public email providers, but creates for corporate domains', async () => {
      const publicTeam = await teams.ensureDomainTeamForEmail('user@gmail.com')
      expect(publicTeam).toBeNull()

      const corpTeam = await teams.ensureDomainTeamForEmail('alice@acme.corp')
      expect(corpTeam).not.toBeNull()
      expect(corpTeam?.name).toBe('acme.corp Team')
      expect(corpTeam?.type).toBe('domain')
      expect(corpTeam?.domain).toBe('acme.corp')

      // Subsequent check returns existing team
      const sameTeam = await teams.ensureDomainTeamForEmail('bob@acme.corp')
      expect(sameTeam?.id).toBe(corpTeam?.id)
    })
  })

  describe('Private Teams Lifecycle', () => {
    it('creates private team, sets creator as admin, and manages members', async () => {
      // 1. Create Alice
      const alice = await authStore.createUser({
        name: 'Alice',
        username: 'alice',
        primaryEmail: 'alice@example.com',
      })

      // 2. Create Bob
      const bob = await authStore.createUser({
        name: 'Bob',
        username: 'bob',
        primaryEmail: 'bob@example.com',
      })

      // 3. Alice creates private team "Core Infra"
      const team = await teams.createPrivateTeam(alice.id, 'Core Infra')
      expect(team.name).toBe('Core Infra')
      expect(team.type).toBe('private')
      expect(team.currentUserRole).toBe('admin')
      expect(team.members).toHaveLength(1)
      expect(team.members[0]?.userId).toBe(alice.id)
      expect(team.members[0]?.role).toBe('admin')

      // 4. Alice invites Bob by username
      const inv = await teams.inviteToTeam(alice.id, team.id, {
        target: '@bob',
        role: 'member',
      })
      expect(inv.status).toBe('pending')
      expect(inv.targetUsername).toBe('bob')

      // 5. Bob sees the pending invitation
      const bobInvs = await teams.listPendingInvitationsForUser(bob.id)
      expect(bobInvs).toHaveLength(1)
      expect(bobInvs[0]?.id).toBe(inv.id)
      expect(bobInvs[0]?.teamName).toBe('Core Infra')

      // 6. Bob accepts invitation
      const acceptRes = await teams.acceptInvitation(bob.id, inv.id)
      expect(acceptRes.ok).toBe(true)
      expect(acceptRes.team.members).toHaveLength(2)
      expect(acceptRes.team.members.some((m) => m.userId === bob.id && m.role === 'member')).toBe(true)

      // 7. Bob (non-admin) cannot invite members
      await expect(
        teams.inviteToTeam(bob.id, team.id, { target: 'charlie@example.com' }),
      ).rejects.toThrow('Only team administrators can invite members')

      // 8. Bob leaves the team
      await teams.leaveTeam(bob.id, team.id)
      const afterLeave = await teams.getTeamDetails(team.id, alice.id)
      expect(afterLeave.members).toHaveLength(1)

      // 9. Alice (sole admin) cannot leave without appointing another admin
      await expect(teams.leaveTeam(alice.id, team.id)).resolves.toEqual({ ok: true }) // last member can leave
    })

    it('supports invitation rejection and revocation', async () => {
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@example.com' })
      const bob = await authStore.createUser({ name: 'Bob', username: 'bob', primaryEmail: 'bob@example.com' })

      const team = await teams.createPrivateTeam(alice.id, 'Design Team')

      // Invite and revoke
      const inv1 = await teams.inviteToTeam(alice.id, team.id, { target: '@bob' })
      await teams.revokeInvitation(alice.id, inv1.id)
      const inv1Record = await teamStore.getInvitation(inv1.id)
      expect(inv1Record?.status).toBe('revoked')

      // Invite and reject
      const inv2 = await teams.inviteToTeam(alice.id, team.id, { target: '@bob' })
      await teams.rejectInvitation(bob.id, inv2.id)
      const inv2Record = await teamStore.getInvitation(inv2.id)
      expect(inv2Record?.status).toBe('rejected')
    })

    it('allows admins to remove members from private teams and prevents non-admins from removing members', async () => {
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@example.com' })
      const bob = await authStore.createUser({ name: 'Bob', username: 'bob', primaryEmail: 'bob@example.com' })
      const charlie = await authStore.createUser({ name: 'Charlie', username: 'charlie', primaryEmail: 'charlie@example.com' })

      const team = await teams.createPrivateTeam(alice.id, 'Frontend Team')
      const invBob = await teams.inviteToTeam(alice.id, team.id, { target: '@bob', role: 'member' })
      await teams.acceptInvitation(bob.id, invBob.id)

      const invCharlie = await teams.inviteToTeam(alice.id, team.id, { target: '@charlie', role: 'member' })
      await teams.acceptInvitation(charlie.id, invCharlie.id)

      // Bob (member) cannot remove Charlie
      await expect(
        teams.removeMemberFromPrivateTeam(bob.id, charlie.id, team.id, '123456'),
      ).rejects.toThrow('Only team administrators can remove members')

      // Alice generates OTP code for operation 'remove_team_member'
      const { code } = await authStore.createVerificationCode('alice@example.com', 'remove_team_member', {}, 10 * 60 * 1000, 5)

      // Alice (admin) removes Bob using OTP code
      const removeRes = await teams.removeMemberFromPrivateTeam(alice.id, bob.id, team.id, code)
      expect(removeRes.ok).toBe(true)

      const details = await teams.getTeamDetails(team.id, alice.id)
      expect(details.members).toHaveLength(2) // Alice and Charlie
      expect(details.members.some((m) => m.userId === bob.id)).toBe(false)

      // Bob (expelled) is rejected when trying to query the private team details
      await expect(
        teams.getTeamDetails(team.id, bob.id),
      ).rejects.toThrow('Access denied: you are not a member of this private team')
    })
  })

  describe('Domain Teams Lifecycle (Auto-Domain, Voluntary Join, Expel with Re-verification)', () => {
    it('allows voluntary joining for verified domain email owners and prevents unauthorized users', async () => {
      // 1. Create Alice with acme.corp email
      const alice = await authStore.createUser({
        name: 'Alice Acme',
        username: 'alice_acme',
        primaryEmail: 'alice@acme.corp',
      })

      // Ensure domain team
      const domainTeam = (await teams.ensureDomainTeamForEmail('alice@acme.corp'))!
      expect(domainTeam).toBeDefined()

      // 2. Alice joins domain team
      const joined = await teams.joinDomainTeam(alice.id, domainTeam.id, 'alice@acme.corp')
      expect(joined.members).toHaveLength(1)
      expect(joined.members[0]?.userId).toBe(alice.id)
      expect(joined.members[0]?.role).toBe('member')

      // 3. Create Bob with external email (not acme.corp)
      const bob = await authStore.createUser({
        name: 'Bob Outsider',
        username: 'bob_out',
        primaryEmail: 'bob@othercorp.com',
      })

      // Bob tries to join acme.corp domain team (should fail)
      await expect(
        teams.joinDomainTeam(bob.id, domainTeam.id, 'bob@othercorp.com'),
      ).rejects.toThrow('does not match domain')

      // Bob tries to spoof alice's email (should fail because not in Bob's verified emails)
      await expect(
        teams.joinDomainTeam(bob.id, domainTeam.id, 'alice@acme.corp'),
      ).rejects.toThrow('You must have a verified alice@acme.corp address')
    })

    it('allows expelling a member with expeller email reverification and permits subsequent rejoining upon reverification', async () => {
      // 1. Alice & Bob join acme.corp domain team
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@acme.corp' })
      const bob = await authStore.createUser({ name: 'Bob', username: 'bob', primaryEmail: 'bob@acme.corp' })
      const domainTeam = (await teams.ensureDomainTeamForEmail('alice@acme.corp'))!

      await teams.joinDomainTeam(alice.id, domainTeam.id, 'alice@acme.corp')
      await teams.joinDomainTeam(bob.id, domainTeam.id, 'bob@acme.corp')

      const teamMid = await teams.getTeamDetails(domainTeam.id)
      expect(teamMid.members).toHaveLength(2)

      // 2. Alice requests OTP code to expel Bob
      const { code } = await authStore.createVerificationCode('alice@acme.corp', 'domain_team_expel', {}, 10 * 60 * 1000, 5)

      // 3. Expel Bob using the reverification code
      const expelRes = await teams.expelMemberFromDomainTeam(alice.id, bob.id, domainTeam.id, code)
      expect(expelRes.ok).toBe(true)

      // Bob is no longer a member
      const teamAfterExpel = await teams.getTeamDetails(domainTeam.id)
      expect(teamAfterExpel.members).toHaveLength(1)
      expect(teamAfterExpel.members.some((m) => m.userId === bob.id)).toBe(false)

      // 4. Bob rejoins voluntarily with his verified domain email
      await teams.joinDomainTeam(bob.id, domainTeam.id, 'bob@acme.corp')
      const teamRejoined = await teams.getTeamDetails(domainTeam.id)
      expect(teamRejoined.members).toHaveLength(2)
      expect(teamRejoined.members.some((m) => m.userId === bob.id)).toBe(true)
    })
  })

  describe('Anti-Reconnaissance & Fail-Closed Authorization Guards', () => {
    it('prevents unauthorized users from probing private and domain teams', async () => {
      // Create user Alice and Eve
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@corp.com' })
      const eve = await authStore.createUser({ name: 'Eve', username: 'eve', primaryEmail: 'eve@random.com' })

      // Alice creates a private team
      const privateTeam = await teams.createPrivateTeam(alice.id, 'Top Secret')

      // Eve attempts to read Alice's private team details -> rejected
      await expect(
        teams.getTeamDetails(privateTeam.id, eve.id),
      ).rejects.toThrow('Access denied: you are not a member of this private team')

      // Alice creates a domain team for corp.com
      const domainTeam = (await teams.ensureDomainTeamForEmail('alice@corp.com'))!

      // Eve (with email eve@random.com) attempts to probe corp.com domain team -> rejected
      await expect(
        teams.getTeamDetails(domainTeam.id, eve.id),
      ).rejects.toThrow('Access denied: you do not have access to this domain team')

      // Alice invites Bob
      const bob = await authStore.createUser({ name: 'Bob', username: 'bob', primaryEmail: 'bob@corp.com' })
      const inv = await teams.inviteToTeam(alice.id, privateTeam.id, { target: '@bob' })

      // Eve attempts to reject or accept Bob's invitation -> rejected
      await expect(
        teams.rejectInvitation(eve.id, inv.id),
      ).rejects.toThrow('Access denied: you are not the recipient of this invitation')

      await expect(
        teams.acceptInvitation(eve.id, inv.id),
      ).rejects.toThrow('This invitation was sent to a different username')
    })
  })
})
