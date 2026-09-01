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
    const invitation = await this.store.createInvitation(
      teamId,
      actorUserId,
      role,
      { email: targetEmail, username: targetUsername },
    )

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

    const selectedEmail = contextEmail
      ? contextEmail.trim().toLowerCase()
      : inv.targetEmail ?? user.defaultEmail

    await this.store.addMember(inv.teamId, userId, inv.role, selectedEmail)
    await this.store.updateInvitationStatus(invitationId, 'accepted')

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

    const result: Array<TeamInvitation & { teamName: string; inviterName: string }> = []
    for (const inv of rawInvs) {
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

    return {
      ...team,
      members: membersWithUser,
      memberCount: membersWithUser.length,
      currentUserRole: currentMember?.role,
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
