import type { AuthService } from '../auth/service'
import { isEmailLike, normalizeUsername } from '../auth/store'
import { MemoryTeamStore, type TeamStore } from './store'
import type { Team, TeamInvitation, TeamMemberWithUser, TeamRole, TeamWithDetails } from './types'
import { defineAbilityForUser, assertCan, type AppAbility } from '../authz'

const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'gmx.com',
  'fastmail.com',
])

export function extractEmailDomain(email: string): string | null {
  const parts = email.trim().toLowerCase().split('@')
  if (parts.length !== 2 || !parts[1] || !parts[1].includes('.')) return null
  return parts[1]
}

export function isPublicDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase())
}

const TEAM_ROLE_WEIGHT: Record<TeamRole, number> = {
  admin: 2,
  member: 1,
}

export function higherTeamRole(a: TeamRole, b: TeamRole): TeamRole {
  return (TEAM_ROLE_WEIGHT[a] ?? 0) >= (TEAM_ROLE_WEIGHT[b] ?? 0) ? a : b
}

export class TeamService {
  constructor(
    public readonly store: TeamStore = new MemoryTeamStore(),
    public readonly auth: AuthService,
  ) {}

  /** Resolve the CASL AppAbility instance for a given user */
  async getAbilityForUser(userId?: string): Promise<AppAbility> {
    if (!userId) return defineAbilityForUser(undefined)
    const profile = await this.auth.getUserProfile(userId)
    return defineAbilityForUser(profile ?? undefined)
  }

  /** Automatically check and create a domain team for a corporate / private domain upon email verification */
  async ensureDomainTeamForEmail(email: string): Promise<Team | null> {
    const domain = extractEmailDomain(email)
    if (!domain || isPublicDomain(domain)) return null

    let team = await this.store.getTeamByDomain(domain)
    if (!team) {
      team = await this.store.createTeam(`${domain} Team`, 'domain', 'system', domain)
    }
    return team
  }

  /** Create a new private team */
  async createPrivateTeam(userId: string, name: string): Promise<TeamWithDetails> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Team name is required')

    const user = await this.auth.getUserProfile(userId)
    if (!user) throw new Error('User not found')

    const team = await this.store.createTeam(trimmed, 'private', userId)
    await this.store.addMember(team.id, userId, 'admin', user.defaultEmail)

    return this.getTeamDetails(team.id, userId)
  }

  /** Voluntary join to a domain team for a user with a verified email in that domain */
  async joinDomainTeam(
    userId: string,
    teamId: string,
    contextEmail: string,
  ): Promise<TeamWithDetails> {
    const team = await this.store.getTeam(teamId)
    if (!team || team.type !== 'domain' || !team.domain) {
      throw new Error('Team not found or is not a domain team')
    }

    const normEmail = contextEmail.trim().toLowerCase()
    const userEmails = await this.auth.store.getUserEmails(userId)
    const matched = userEmails.find((e) => e.email === normEmail && e.verifiedAt !== null)

    if (!matched) {
      throw new Error(`You must have a verified ${normEmail} address to join this domain team`)
    }

    const emailDomain = extractEmailDomain(normEmail)
    if (emailDomain !== team.domain) {
      throw new Error(`Email ${normEmail} does not match domain ${team.domain}`)
    }

    await this.store.addMember(team.id, userId, 'member', normEmail)
    return this.getTeamDetails(team.id, userId)
  }

  /** Expel a member from a domain team with mandatory recent reverification of the expeller's domain email */
  async expelMemberFromDomainTeam(
    expellerUserId: string,
    targetUserId: string,
    teamId: string,
    reverificationCode: string,
  ): Promise<{ ok: true }> {
    const team = await this.store.getTeam(teamId)
    if (!team || team.type !== 'domain' || !team.domain) {
      throw new Error('Invalid domain team')
    }

    const expellerMember = await this.store.getMember(teamId, expellerUserId)
    if (!expellerMember || !expellerMember.contextEmail) {
      throw new Error('You must be a member of this domain team to perform this action')
    }

    // Verify expeller's OTP code for their domain email
    const verifyResult = await this.auth.store.verifyCode(
      expellerMember.contextEmail,
      'domain_team_expel',
      reverificationCode,
    )

    if (!verifyResult.success) {
      throw new Error('Re-verification failed. You must provide a valid code sent to your domain email to expel a member.')
    }

    await this.store.removeMember(teamId, targetUserId)
    return { ok: true }
  }

  /** Invite a user or email to a private team */
  async inviteToTeam(
    actorUserId: string,
    teamId: string,
    options: { target: string; role?: TeamRole },
  ): Promise<TeamInvitation> {
    const team = await this.store.getTeam(teamId)
    if (!team) throw new Error('Team not found')
    if (team.type === 'domain') {
      throw new Error('Domain teams do not use invitations. Eligible users can join directly with their domain email.')
    }

    const actorMember = await this.store.getMember(teamId, actorUserId)
    const rawMembers = await this.store.listMembers(teamId)
    const ability = await this.getAbilityForUser(actorUserId)
    assertCan(ability, 'manage', { ...team, members: rawMembers, __type: 'Team' }, 'Only team administrators can invite members')

    const targetRaw = options.target.trim()
    if (!targetRaw) throw new Error('Target email or username is required')

    let targetEmail: string | undefined
    let targetUsername: string | undefined

    if (isEmailLike(targetRaw)) {
      targetEmail = targetRaw.toLowerCase()
    } else {
      targetUsername = normalizeUsername(targetRaw)
    }

    const role: TeamRole = options.role ?? 'member'

    // Check if target user is already a member of this team
    let existingMemberId: string | undefined
    if (targetUsername) {
      const existingUser = await this.auth.store.getUserByUsername(targetUsername)
      if (existingUser && rawMembers.some((m) => m.userId === existingUser.id)) {
        existingMemberId = existingUser.id
      }
    }
    if (targetEmail) {
      const existingEmail = await this.auth.store.getUserByEmail(targetEmail)
      if (existingEmail && rawMembers.some((m) => m.userId === existingEmail.user.id)) {
        existingMemberId = existingEmail.user.id
      }
    }

    if (existingMemberId) {
      const existingMember = rawMembers.find((m) => m.userId === existingMemberId)!
      if (TEAM_ROLE_WEIGHT[role] > TEAM_ROLE_WEIGHT[existingMember.role]) {
        await this.store.updateMemberRole(teamId, existingMemberId, role)
        // Return synthetic invitation record for the upgrade
        return {
          id: `upgrade-${Date.now()}`,
          teamId,
          invitedBy: actorUserId,
          targetEmail,
          targetUsername,
          role,
          status: 'accepted',
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          createdAt: Date.now(),
        }
      }
      throw new Error(`User is already a member of this team with role ${existingMember.role}`)
    }

    // Check if an existing active pending invitation exists for this team and target
    const existingTeamInvs = await this.store.listInvitationsForTeam(teamId)
    const existingInv = existingTeamInvs.find(
      (i) =>
        i.status === 'pending' &&
        ((targetEmail && i.targetEmail === targetEmail) ||
          (targetUsername && i.targetUsername === targetUsername)),
    )

    if (existingInv) {
      if (TEAM_ROLE_WEIGHT[role] > TEAM_ROLE_WEIGHT[existingInv.role]) {
        await this.store.updateInvitationRole(existingInv.id, role)
        existingInv.role = role
      }
      // Re-send notification if invited by email
      if (targetEmail) {
        const actor = await this.auth.store.getUser(actorUserId)
        const inviterName = actor?.name || actor?.username || 'A team member'
        const appUrl = (process.env.MD4LP_APP_URL || 'http://localhost:5173').replace(/\/+$/, '')
        const pendingUrl = `${appUrl}/#pending`
        await this.auth.outbox.sendNotificationEmail(
          targetEmail,
          `You've been invited to join team "${team.name}" on md4lp`,
          [
            `Hello,`,
            ``,
            `${inviterName} has invited you to collaborate in the team "${team.name}" as ${existingInv.role}.`,
            ``,
            `To view and accept your invitation:`,
            `1. Open md4lp at: ${pendingUrl}`,
            `2. Sign in or create an account with this email address (${targetEmail}).`,
            `3. Your invitation to "${team.name}" will be ready to accept immediately.`,
            ``,
            `— md4lp team`,
          ].join('\n'),
          'team_invitation',
        )
      }
      return existingInv
    }

    const invitation = await this.store.createInvitation(
      teamId,
      actorUserId,
      role,
      { email: targetEmail, username: targetUsername },
    )

    // If invited by email, send an invitation notification to outbox with registration CTA
    if (targetEmail) {
      const actor = await this.auth.store.getUser(actorUserId)
      const inviterName = actor?.name || actor?.username || 'A team member'
      const appUrl = (process.env.MD4LP_APP_URL || 'http://localhost:5173').replace(/\/+$/, '')
      const pendingUrl = `${appUrl}/#pending`
      await this.auth.outbox.sendNotificationEmail(
        targetEmail,
        `You've been invited to join team "${team.name}" on md4lp`,
        [
          `Hello,`,
          ``,
          `${inviterName} has invited you to collaborate in the team "${team.name}" as ${role}.`,
          ``,
          `To view and accept your invitation:`,
          `1. Open md4lp at: ${pendingUrl}`,
          `2. Sign in or create an account with this email address (${targetEmail}).`,
          `3. Your invitation to "${team.name}" will be ready to accept immediately.`,
          ``,
          `— md4lp team`,
        ].join('\n'),
        'team_invitation',
      )
    }

    return invitation
  }

  /** Accept a team invitation */
  async acceptInvitation(
    userId: string,
    invitationId: string,
    contextEmail?: string,
  ): Promise<{ ok: true; team: TeamWithDetails }> {
    const inv = await this.store.getInvitation(invitationId)
    if (!inv || inv.status !== 'pending') {
      throw new Error('Invitation is not valid or has expired')
    }

    const ability = await this.getAbilityForUser(userId)
    assertCan(ability, 'accept', { ...inv, __type: 'TeamInvitation' }, 'This invitation was sent to a different username')

    const user = await this.auth.getUserProfile(userId)
    if (!user) throw new Error('User not found')

    const userEmails = await this.auth.store.getUserEmails(userId)
    const verifiedEmails = userEmails.filter((e) => e.verifiedAt !== null).map((e) => e.email)

    // Find all pending invitations to this team for this user and determine the highest privilege role
    const allUserInvs = await this.store.listPendingInvitationsForUser(verifiedEmails, user.username)
    const teamInvs = allUserInvs.filter((i) => i.teamId === inv.teamId)
    const effectiveRole = teamInvs.reduce((max, cur) => higherTeamRole(max, cur.role), inv.role)

    const selectedEmail = contextEmail
      ? contextEmail.trim().toLowerCase()
      : inv.targetEmail ?? user.defaultEmail

    await this.store.addMember(inv.teamId, userId, effectiveRole, selectedEmail)
    await this.store.updateInvitationStatus(invitationId, 'accepted')

    // Auto-resolve any redundant pending invitations to this same team for this user
    for (const otherInv of teamInvs) {
      if (otherInv.id !== invitationId) {
        await this.store.updateInvitationStatus(otherInv.id, 'accepted')
      }
    }

    const details = await this.getTeamDetails(inv.teamId, userId)
    return { ok: true, team: details }
  }

  /** Reject a team invitation */
  async rejectInvitation(userId: string, invitationId: string): Promise<{ ok: true }> {
    const inv = await this.store.getInvitation(invitationId)
    if (!inv || inv.status !== 'pending') {
      throw new Error('Invitation not found or not pending')
    }

    const ability = await this.getAbilityForUser(userId)
    assertCan(ability, 'reject', { ...inv, __type: 'TeamInvitation' }, 'Access denied: you are not the recipient of this invitation')

    await this.store.updateInvitationStatus(invitationId, 'rejected')

    // Auto-resolve any redundant pending invitations to this same team for this user
    const user = await this.auth.getUserProfile(userId)
    if (user) {
      const verifiedEmails = user.emails.filter((e) => e.verifiedAt !== null).map((e) => e.email)
      const allUserInvs = await this.store.listPendingInvitationsForUser(verifiedEmails, user.username)
      for (const otherInv of allUserInvs) {
        if (otherInv.teamId === inv.teamId && otherInv.id !== invitationId) {
          await this.store.updateInvitationStatus(otherInv.id, 'rejected')
        }
      }
    }

    return { ok: true }
  }

  /** Revoke a team invitation (admin action) */
  async revokeInvitation(actorUserId: string, invitationId: string): Promise<{ ok: true }> {
    const inv = await this.store.getInvitation(invitationId)
    if (!inv || inv.status !== 'pending') {
      throw new Error('Invitation not found or not pending')
    }

    const member = await this.store.getMember(inv.teamId, actorUserId)
    if (!member || member.role !== 'admin') {
      throw new Error('Only team administrators can revoke invitations')
    }

    await this.store.updateInvitationStatus(invitationId, 'revoked')
    return { ok: true }
  }

  /** Leave a team */
  async leaveTeam(userId: string, teamId: string): Promise<{ ok: true }> {
    const member = await this.store.getMember(teamId, userId)
    if (!member) throw new Error('You are not a member of this team')

    const team = await this.store.getTeam(teamId)
    if (team?.type === 'private' && member.role === 'admin') {
      const allMembers = await this.store.listMembers(teamId)
      const otherAdmins = allMembers.filter((m) => m.userId !== userId && m.role === 'admin')
      const otherMembers = allMembers.filter((m) => m.userId !== userId)
      if (otherAdmins.length === 0 && otherMembers.length > 0) {
        throw new Error('Cannot leave team as the sole admin. Please appoint another admin first.')
      }
    }

    await this.store.removeMember(teamId, userId)
    return { ok: true }
  }

  /** Expel / remove a member from a private team (admin action requiring OTP operation reverification) */
  async removeMemberFromPrivateTeam(
    actorUserId: string,
    targetUserId: string,
    teamId: string,
    reverificationCode: string,
  ): Promise<{ ok: true }> {
    const team = await this.store.getTeam(teamId)
    if (!team) throw new Error('Team not found')
    if (team.type !== 'private') {
      throw new Error('This endpoint is only for private teams. For domain teams, use domain expulsion.')
    }

    const rawMembers = await this.store.listMembers(teamId)
    const ability = await this.getAbilityForUser(actorUserId)
    assertCan(ability, 'manage', { ...team, members: rawMembers, __type: 'Team' }, 'Only team administrators can remove members from this team')

    if (actorUserId === targetUserId) {
      throw new Error('Cannot remove yourself with this action. Use Leave Team instead.')
    }

    const target = await this.store.getMember(teamId, targetUserId)
    if (!target) {
      throw new Error('User is not a member of this team')
    }

    const actorProfile = await this.auth.getUserProfile(actorUserId)
    if (!actorProfile || !actorProfile.defaultEmail) {
      throw new Error('Actor has no verified email address')
    }

    const verifyResult = await this.auth.store.verifyCode(
      actorProfile.defaultEmail,
      'remove_team_member',
      reverificationCode,
    )

    if (!verifyResult.success) {
      throw new Error('Re-verification failed. Please provide a valid code sent to your email to confirm member removal.')
    }

    await this.store.removeMember(teamId, targetUserId)
    return { ok: true }
  }

  /** List pending invitations for a user across all their verified emails & username */
  async listPendingInvitationsForUser(userId: string): Promise<Array<TeamInvitation & { teamName: string; inviterName: string }>> {
    const user = await this.auth.getUserProfile(userId)
    if (!user) return []
    const emails = user.emails.filter((e) => e.verifiedAt !== null).map((e) => e.email)
    const rawInvs = await this.store.listPendingInvitationsForUser(emails, user.username)

    // Group by teamId and select the highest role priority (admin > member)
    const invsByTeam = new Map<string, TeamInvitation>()
    for (const inv of rawInvs) {
      const prev = invsByTeam.get(inv.teamId)
      if (!prev || (TEAM_ROLE_WEIGHT[inv.role] ?? 0) > (TEAM_ROLE_WEIGHT[prev.role] ?? 0)) {
        invsByTeam.set(inv.teamId, inv)
      }
    }

    const result: Array<TeamInvitation & { teamName: string; inviterName: string }> = []
    for (const inv of invsByTeam.values()) {
      const team = await this.store.getTeam(inv.teamId)
      const inviter = await this.auth.store.getUser(inv.invitedBy)
      result.push({
        ...inv,
        teamName: team?.name ?? 'Unknown Team',
        inviterName: inviter?.name ?? 'Unknown User',
      })
    }
    return result
  }

  /** Get complete details for a team, including members with profiles (with membership authorization check) */
  async getTeamDetails(teamId: string, currentUserId?: string): Promise<TeamWithDetails> {
    const team = await this.store.getTeam(teamId)
    if (!team) throw new Error('Team not found')

    const rawMembers = await this.store.listMembers(teamId)
    const currentMember = currentUserId ? rawMembers.find((m) => m.userId === currentUserId) : undefined

    if (currentUserId) {
      const ability = await this.getAbilityForUser(currentUserId)
      assertCan(
        ability,
        'read',
        { ...team, members: rawMembers, __type: 'Team' },
        team.type === 'private'
          ? 'Access denied: you are not a member of this private team'
          : 'Access denied: you do not have access to this domain team',
      )
    }

    const membersWithUser: TeamMemberWithUser[] = []

    for (const m of rawMembers) {
      const u = await this.auth.store.getUser(m.userId)
      membersWithUser.push({
        ...m,
        username: u?.username ?? 'unknown',
        name: u?.name ?? 'Unknown User',
        avatarUrl: u?.avatarUrl,
      })
    }

    // Resolve pending invitations for the team if user is admin or member
    let pendingInvitations: TeamInvitation[] | undefined
    if (currentUserId && (currentMember?.role === 'admin' || team.createdBy === currentUserId || rawMembers.some((m) => m.userId === currentUserId))) {
      const rawInvs = await this.store.listInvitationsForTeam(teamId)
      const list: TeamInvitation[] = []
      for (const inv of rawInvs) {
        if (inv.status === 'pending') {
          const inviter = await this.auth.store.getUser(inv.invitedBy)
          list.push({
            ...inv,
            inviterName: inviter?.name ?? inviter?.username ?? 'Unknown User',
          })
        }
      }
      pendingInvitations = list
    }

    return {
      ...team,
      members: membersWithUser,
      memberCount: membersWithUser.length,
      currentUserRole: currentMember?.role,
      pendingInvitations,
    }
  }

  /** List all teams for a user (joined teams + discoverable domain teams) */
  async listTeamsOverviewForUser(userId: string): Promise<{
    joinedTeams: TeamWithDetails[]
    availableDomainTeams: Team[]
  }> {
    const joined = await this.store.listTeamsForUser(userId)
    const joinedDetails = await Promise.all(joined.map((t) => this.getTeamDetails(t.id, userId)))

    const user = await this.auth.getUserProfile(userId)
    const availableDomainTeams: Team[] = []

    if (user) {
      const verifiedEmails = user.emails.filter((e) => e.verifiedAt !== null)
      const domains = new Set(
        verifiedEmails
          .map((e) => extractEmailDomain(e.email))
          .filter((d): d is string => Boolean(d && !isPublicDomain(d))),
      )

      for (const domain of domains) {
        const team = await this.store.getTeamByDomain(domain)
        if (team && !joined.some((j) => j.id === team.id)) {
          availableDomainTeams.push(team)
        }
      }
    }

    return {
      joinedTeams: joinedDetails,
      availableDomainTeams,
    }
  }
}
