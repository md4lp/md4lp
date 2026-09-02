import path from 'node:path'
import { LocalGitBackend, type Author, type RepoBackend } from '@md4lp/repo'
import { isEmailLike, normalizeUsername } from '../auth/store'
import type { AuthService } from '../auth/service'
import type { TeamService } from '../teams/service'
import { defineAbilityForUser, assertCan, type AppAbility } from '../authz'
import { MemoryProjectStore, type ProjectStore } from './store'
import type {
  Project,
  ProjectWithDetails,
  ProjectRole,
  ProjectMemberWithUser,
  ProjectTeamWithDetails,
  ProjectInvitation,
} from './types'

const PROJECT_ROLE_WEIGHT: Record<ProjectRole, number> = {
  owner: 4,
  editor: 3,
  commenter: 2,
  viewer: 1,
}

export function higherProjectRole(a: ProjectRole, b: ProjectRole): ProjectRole {
  return (PROJECT_ROLE_WEIGHT[a] ?? 0) >= (PROJECT_ROLE_WEIGHT[b] ?? 0) ? a : b
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  )
}

export class ProjectService {
  constructor(
    public readonly store: ProjectStore = new MemoryProjectStore(),
    public readonly auth: AuthService,
    public readonly teams: TeamService,
    public readonly reposBaseDir: string,
  ) {}

  async getAbilityForUser(userId?: string): Promise<AppAbility> {
    if (!userId) return defineAbilityForUser(undefined)
    const profile = await this.auth.getUserProfile(userId)
    return defineAbilityForUser(profile ?? undefined)
  }

  async listAllProjects(): Promise<Project[]> {
    return this.store.listAllProjects()
  }

  async getProjectRepo(projectId: string): Promise<RepoBackend> {
    const project = await this.store.getProject(projectId)
    if (!project) throw new Error('Project not found')
    return new LocalGitBackend(project.repoPath)
  }

  async createProject(
    ownerUserId: string,
    options: {
      name: string
      slug?: string
      description?: string
      contextEmail?: string
      initialReadme?: string
    },
  ): Promise<ProjectWithDetails> {
    const owner = await this.auth.getUserProfile(ownerUserId)
    if (!owner || owner.status === 'suspended') {
      throw new Error('Owner user not found or account is suspended')
    }

    const name = options.name.trim()
    if (!name) throw new Error('Project name is required')

    let slug = options.slug ? slugify(options.slug) : slugify(name)
    let existing = await this.store.getProjectBySlug(slug)
    if (existing) {
      slug = `${slug}-${Math.random().toString(36).substring(2, 6)}`
    }

    const contextEmail = options.contextEmail
      ? options.contextEmail.trim().toLowerCase()
      : owner.defaultEmail

    const verifiedEmails = owner.emails.filter((e) => e.verifiedAt !== null).map((e) => e.email.toLowerCase())
    if (!verifiedEmails.includes(contextEmail.toLowerCase())) {
      throw new Error(`You must have ${contextEmail} verified on your account to use it as project context email`)
    }

    const repoPath = path.join(this.reposBaseDir, slug)
    const author: Author = { name: owner.name || owner.username, email: contextEmail }

    // Initialize the isolated git repo
    const gitRepo = await LocalGitBackend.init(repoPath, author, 'main')
    const readmeContent = options.initialReadme ?? `# ${name}\n\n${options.description || 'Welcome to ' + name + '.'}\n`
    await gitRepo.writeFiles('main', [{ path: 'README.md', content: readmeContent }], 'initial commit: README.md', author)

    // Create project in store
    const project = await this.store.createProject({
      name,
      slug,
      description: options.description?.trim(),
      repoPath,
      ownerUserId,
    })

    // Add owner as direct member
    await this.store.addMember(project.id, ownerUserId, 'owner', contextEmail)

    return this.getProjectDetails(project.id, ownerUserId)
  }

  async getProjectDetails(projectId: string, currentUserId?: string): Promise<ProjectWithDetails> {
    const project = await this.store.getProject(projectId)
    if (!project) throw new Error('Project not found')

    const rawMembers = await this.store.listMembers(projectId)
    const rawTeams = await this.store.listTeamsForProject(projectId)

    // Build member details with user profile
    const membersWithUser: ProjectMemberWithUser[] = []
    for (const m of rawMembers) {
      const u = await this.auth.store.getUser(m.userId)
      membersWithUser.push({
        ...m,
        username: u?.username ?? 'unknown',
        name: u?.name ?? 'Unknown User',
        avatarUrl: u?.avatarUrl,
      })
    }

    // Build team details with team info
    const teamsWithDetails: ProjectTeamWithDetails[] = []
    const teamMembersSet = new Map<string, { role: ProjectRole; contextEmail?: string }>()

    for (const t of rawTeams) {
      const team = await this.teams.store.getTeam(t.teamId)
      const tMembers = await this.teams.store.listMembers(t.teamId)
      if (team) {
        teamsWithDetails.push({
          ...t,
          teamName: team.name,
          teamType: team.type,
          memberCount: tMembers.length,
        })
        for (const tm of tMembers) {
          const current = teamMembersSet.get(tm.userId)
          if (!current || PROJECT_ROLE_WEIGHT[t.role] > PROJECT_ROLE_WEIGHT[current.role]) {
            teamMembersSet.set(tm.userId, { role: t.role, contextEmail: tm.contextEmail })
          }
        }
      }
    }

    // Build all effective members list for CASL evaluation
    const allEffectiveMembers = [...rawMembers]
    for (const [tUserId, tInfo] of teamMembersSet.entries()) {
      if (!allEffectiveMembers.some((m) => m.userId === tUserId)) {
        allEffectiveMembers.push({
          projectId,
          userId: tUserId,
          role: tInfo.role,
          contextEmail: tInfo.contextEmail || '',
          joinedAt: Date.now(),
        })
      }
    }

    // Resolve current user effective role and contextual email
    let effectiveRole: ProjectRole | undefined
    let currentContextEmail: string | undefined

    if (currentUserId) {
      const directMember = rawMembers.find((m) => m.userId === currentUserId)
      const teamInherited = teamMembersSet.get(currentUserId)

      if (directMember && teamInherited) {
        effectiveRole =
          PROJECT_ROLE_WEIGHT[directMember.role] >= PROJECT_ROLE_WEIGHT[teamInherited.role]
            ? directMember.role
            : teamInherited.role
        currentContextEmail = directMember.contextEmail || teamInherited.contextEmail
      } else if (directMember) {
        effectiveRole = directMember.role
        currentContextEmail = directMember.contextEmail
      } else if (teamInherited) {
        effectiveRole = teamInherited.role
        currentContextEmail = teamInherited.contextEmail
      }

      const ability = await this.getAbilityForUser(currentUserId)
      assertCan(
        ability,
        'read',
        { ...project, members: allEffectiveMembers, __type: 'Project' },
        'Access denied: you are not a member of this project',
      )
    }

    // If user is owner or member, resolve pending invitations for the project
    let pendingInvitations: ProjectInvitation[] | undefined
    if (currentUserId && (effectiveRole === 'owner' || rawMembers.some((m) => m.userId === currentUserId))) {
      const rawInvs = await this.store.listInvitationsForProject(projectId)
      const list: ProjectInvitation[] = []
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
      ...project,
      members: membersWithUser,
      teams: teamsWithDetails,
      effectiveRole,
      currentContextEmail,
      pendingInvitations,
    }
  }

  async listProjectsForUser(userId: string): Promise<ProjectWithDetails[]> {
    const userTeams = await this.teams.store.listTeamsForUser(userId)
    const userTeamIds = new Set(userTeams.map((t) => t.id))

    const allProjects = await this.store.listAllProjects()
    const accessible: ProjectWithDetails[] = []

    for (const p of allProjects) {
      const members = await this.store.listMembers(p.id)
      const isDirect = members.some((m) => m.userId === userId)

      const teams = await this.store.listTeamsForProject(p.id)
      const isTeamMember = teams.some((t) => userTeamIds.has(t.teamId))

      if (isDirect || isTeamMember) {
        try {
          const details = await this.getProjectDetails(p.id, userId)
          accessible.push(details)
        } catch {
          // ignore inaccessible
        }
      }
    }

    return accessible
  }

  async inviteToProject(
    actorUserId: string,
    projectId: string,
    options: { target: string; role?: ProjectRole },
  ): Promise<ProjectInvitation> {
    const project = await this.getProjectDetails(projectId, actorUserId)
    const ability = await this.getAbilityForUser(actorUserId)
    assertCan(ability, 'manage', { ...project, __type: 'Project' }, 'Only project owners can invite members')

    const targetRaw = options.target.trim()
    if (!targetRaw) throw new Error('Target username or email is required')

    let targetEmail: string | undefined
    let targetUsername: string | undefined

    if (isEmailLike(targetRaw)) {
      targetEmail = targetRaw.toLowerCase()
    } else {
      targetUsername = normalizeUsername(targetRaw)
    }

    const role: ProjectRole = options.role ?? 'editor'

    // Check if target user is already a direct member
    let existingMemberId: string | undefined
    if (targetUsername) {
      const existingUser = await this.auth.store.getUserByUsername(targetUsername)
      if (existingUser && project.members.some((m) => m.userId === existingUser.id)) {
        existingMemberId = existingUser.id
      }
    }
    if (targetEmail) {
      const existingEmail = await this.auth.store.getUserByEmail(targetEmail)
      if (existingEmail && project.members.some((m) => m.userId === existingEmail.user.id)) {
        existingMemberId = existingEmail.user.id
      }
    }

    if (existingMemberId) {
      const existingMember = project.members.find((m) => m.userId === existingMemberId)!
      if (PROJECT_ROLE_WEIGHT[role] > PROJECT_ROLE_WEIGHT[existingMember.role]) {
        await this.store.updateMemberRole(projectId, existingMemberId, role)
        return {
          id: `upgrade-${Date.now()}`,
          projectId,
          invitedBy: actorUserId,
          targetEmail,
          targetUsername,
          role,
          status: 'accepted',
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          createdAt: Date.now(),
        }
      }
      throw new Error(`User is already a member of this project with role ${existingMember.role}`)
    }

    // Check if an existing active pending invitation exists for this project and target
    const existingProjectInvs = await this.store.listInvitationsForProject(projectId)
    const existingInv = existingProjectInvs.find(
      (i) =>
        i.status === 'pending' &&
        ((targetEmail && i.targetEmail === targetEmail) ||
          (targetUsername && i.targetUsername === targetUsername)),
    )

    if (existingInv) {
      if (PROJECT_ROLE_WEIGHT[role] > PROJECT_ROLE_WEIGHT[existingInv.role]) {
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
          `You've been invited to join project "${project.name}" on md4lp`,
          [
            `Hello,`,
            ``,
            `${inviterName} has invited you to collaborate on the project "${project.name}" as ${existingInv.role}.`,
            ``,
            `To view and accept your invitation:`,
            `1. Open md4lp at: ${pendingUrl}`,
            `2. Sign in or create an account with this email address (${targetEmail}).`,
            `3. Your invitation to "${project.name}" will be ready to accept immediately.`,
            ``,
            `— md4lp team`,
          ].join('\n'),
          'project_invitation',
        )
      }
      return existingInv
    }

    const inv = await this.store.createInvitation(projectId, actorUserId, role, { email: targetEmail, username: targetUsername })

    // If invited by email, send an invitation notification to outbox with registration CTA
    if (targetEmail) {
      const actor = await this.auth.store.getUser(actorUserId)
      const inviterName = actor?.name || actor?.username || 'A team member'
      const appUrl = (process.env.MD4LP_APP_URL || 'http://localhost:5173').replace(/\/+$/, '')
      const pendingUrl = `${appUrl}/#pending`
      await this.auth.outbox.sendNotificationEmail(
        targetEmail,
        `You've been invited to join project "${project.name}" on md4lp`,
        [
          `Hello,`,
          ``,
          `${inviterName} has invited you to collaborate on the project "${project.name}" as ${role}.`,
          ``,
          `To view and accept your invitation:`,
          `1. Open md4lp at: ${pendingUrl}`,
          `2. Sign in or create an account with this email address (${targetEmail}).`,
          `3. Your invitation to "${project.name}" will be ready to accept immediately.`,
          ``,
          `— md4lp team`,
        ].join('\n'),
        'project_invitation',
      )
    }

    return inv
  }

  async updateMemberContextEmail(
    userId: string,
    projectId: string,
    newContextEmail: string,
  ): Promise<{ ok: true; contextEmail: string }> {
    const member = await this.store.getMember(projectId, userId)
    if (!member) {
      throw new Error('You are not a direct member of this project')
    }

    const normEmail = newContextEmail.trim().toLowerCase()
    const userEmails = await this.auth.store.getUserEmails(userId)
    const matched = userEmails.find((e) => e.email === normEmail && e.verifiedAt !== null)
    if (!matched) {
      throw new Error(`You must have ${normEmail} verified on your account to use it for Git signatures`)
    }

    await this.store.updateMemberContextEmail(projectId, userId, normEmail)
    return { ok: true, contextEmail: normEmail }
  }

  async acceptInvitation(
    userId: string,
    invitationId: string,
    options?: { contextEmail?: string },
  ): Promise<{ ok: true; project: ProjectWithDetails }> {
    const inv = await this.store.getInvitation(invitationId)
    if (!inv || inv.status !== 'pending') {
      throw new Error('Invitation is not valid or has expired')
    }

    const user = await this.auth.getUserProfile(userId)
    if (!user) throw new Error('User not found')

    const ability = await this.getAbilityForUser(userId)
    assertCan(ability, 'accept', { ...inv, __type: 'ProjectInvitation' }, 'This invitation was sent to a different username or email')

    const userEmails = await this.auth.store.getUserEmails(userId)
    const verifiedEmails = userEmails.filter((e) => e.verifiedAt !== null).map((e) => e.email.toLowerCase())

    // Find all pending invitations to this project for this user and determine highest privilege role
    const allUserInvs = await this.store.listPendingInvitationsForUser(verifiedEmails, user.username)
    const projectInvs = allUserInvs.filter((i) => i.projectId === inv.projectId)
    const effectiveRole = projectInvs.reduce((max, cur) => higherProjectRole(max, cur.role), inv.role)

    const selectedEmail = options?.contextEmail
      ? options.contextEmail.trim().toLowerCase()
      : inv.targetEmail ?? user.defaultEmail

    if (!verifiedEmails.includes(selectedEmail.toLowerCase())) {
      throw new Error(`You must have ${selectedEmail} verified on your account to use it as project context email`)
    }

    await this.store.addMember(inv.projectId, userId, effectiveRole, selectedEmail)
    await this.store.updateInvitationStatus(invitationId, 'accepted')

    // Auto-resolve any redundant pending invitations to this same project for this user
    for (const otherInv of projectInvs) {
      if (otherInv.id !== invitationId) {
        await this.store.updateInvitationStatus(otherInv.id, 'accepted')
      }
    }

    const details = await this.getProjectDetails(inv.projectId, userId)
    return { ok: true, project: details }
  }

  async rejectInvitation(userId: string, invitationId: string): Promise<{ ok: true }> {
    const inv = await this.store.getInvitation(invitationId)
    if (!inv || inv.status !== 'pending') {
      throw new Error('Invitation not found or not pending')
    }

    const ability = await this.getAbilityForUser(userId)
    assertCan(ability, 'reject', { ...inv, __type: 'ProjectInvitation' }, 'Access denied: you are not the recipient of this invitation')

    await this.store.updateInvitationStatus(invitationId, 'rejected')

    // Auto-resolve any redundant pending invitations to this same project for this user
    const user = await this.auth.getUserProfile(userId)
    if (user) {
      const verifiedEmails = user.emails.filter((e) => e.verifiedAt !== null).map((e) => e.email.toLowerCase())
      const allUserInvs = await this.store.listPendingInvitationsForUser(verifiedEmails, user.username)
      for (const otherInv of allUserInvs) {
        if (otherInv.projectId === inv.projectId && otherInv.id !== invitationId) {
          await this.store.updateInvitationStatus(otherInv.id, 'rejected')
        }
      }
    }

    return { ok: true }
  }

  async revokeInvitation(actorUserId: string, invitationId: string): Promise<{ ok: true }> {
    const inv = await this.store.getInvitation(invitationId)
    if (!inv || inv.status !== 'pending') {
      throw new Error('Invitation not found or not pending')
    }

    const project = await this.getProjectDetails(inv.projectId, actorUserId)
    const ability = await this.getAbilityForUser(actorUserId)
    assertCan(ability, 'manage', { ...project, __type: 'Project' }, 'Only project owners can revoke invitations')

    await this.store.updateInvitationStatus(invitationId, 'revoked')
    return { ok: true }
  }

  async assignTeamToProject(actorUserId: string, projectId: string, teamId: string, role: ProjectRole): Promise<{ ok: true }> {
    const project = await this.getProjectDetails(projectId, actorUserId)
    const ability = await this.getAbilityForUser(actorUserId)
    assertCan(ability, 'manage', { ...project, __type: 'Project' }, 'Only project owners can assign teams')

    const team = await this.teams.store.getTeam(teamId)
    if (!team) throw new Error('Team not found')

    await this.store.assignTeam(projectId, teamId, role)
    return { ok: true }
  }

  async removeTeamFromProject(actorUserId: string, projectId: string, teamId: string): Promise<{ ok: true }> {
    const project = await this.getProjectDetails(projectId, actorUserId)
    const ability = await this.getAbilityForUser(actorUserId)
    assertCan(ability, 'manage', { ...project, __type: 'Project' }, 'Only project owners can remove teams')

    await this.store.removeTeam(projectId, teamId)
    return { ok: true }
  }

  async removeMemberFromProject(
    actorUserId: string,
    targetUserId: string,
    projectId: string,
    reverificationCode: string,
  ): Promise<{ ok: true }> {
    const project = await this.getProjectDetails(projectId, actorUserId)
    const ability = await this.getAbilityForUser(actorUserId)
    assertCan(ability, 'manage', { ...project, __type: 'Project' }, 'Only project owners can remove members')

    if (actorUserId === targetUserId) {
      throw new Error('Cannot remove yourself with this action. Use Leave Project instead.')
    }

    const target = await this.store.getMember(projectId, targetUserId)
    if (!target) {
      throw new Error('User is not a direct member of this project')
    }

    const actorProfile = await this.auth.getUserProfile(actorUserId)
    if (!actorProfile || !actorProfile.defaultEmail) {
      throw new Error('Actor has no verified email address')
    }

    const verifyResult = await this.auth.store.verifyCode(
      actorProfile.defaultEmail,
      'remove_project_member',
      reverificationCode,
    )

    if (!verifyResult.success) {
      throw new Error('Re-verification failed. Please provide a valid code sent to your email to confirm member removal.')
    }

    await this.store.removeMember(projectId, targetUserId)
    return { ok: true }
  }

  async leaveProject(userId: string, projectId: string): Promise<{ ok: true }> {
    const member = await this.store.getMember(projectId, userId)
    if (!member) throw new Error('You are not a direct member of this project')

    if (member.role === 'owner') {
      const allMembers = await this.store.listMembers(projectId)
      const otherOwners = allMembers.filter((m) => m.userId !== userId && m.role === 'owner')
      const otherMembers = allMembers.filter((m) => m.userId !== userId)
      if (otherOwners.length === 0 && otherMembers.length > 0) {
        throw new Error('Cannot leave project as the sole owner. Please appoint another owner first.')
      }
    }

    await this.store.removeMember(projectId, userId)
    return { ok: true }
  }

  async listPendingInvitationsForUser(
    userId: string,
  ): Promise<Array<ProjectInvitation & { projectName: string; inviterName: string }>> {
    const user = await this.auth.getUserProfile(userId)
    if (!user) return []
    const emails = user.emails.filter((e) => e.verifiedAt !== null).map((e) => e.email)
    const rawInvs = await this.store.listPendingInvitationsForUser(emails, user.username)

    // Group by projectId and select the highest role priority (owner > editor > commenter > viewer)
    const invsByProject = new Map<string, ProjectInvitation>()
    for (const inv of rawInvs) {
      const prev = invsByProject.get(inv.projectId)
      if (!prev || (PROJECT_ROLE_WEIGHT[inv.role] ?? 0) > (PROJECT_ROLE_WEIGHT[prev.role] ?? 0)) {
        invsByProject.set(inv.projectId, inv)
      }
    }

    const result: Array<ProjectInvitation & { projectName: string; inviterName: string }> = []
    for (const inv of invsByProject.values()) {
      const project = await this.store.getProject(inv.projectId)
      const inviter = await this.auth.store.getUser(inv.invitedBy)
      result.push({
        ...inv,
        projectName: project?.name ?? 'Unknown Project',
        inviterName: inviter?.name ?? 'Unknown User',
      })
    }
    return result
  }
}
