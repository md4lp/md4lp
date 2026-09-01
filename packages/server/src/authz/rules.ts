import { AbilityBuilder, createMongoAbility } from '@casl/ability'
import type { AppAbility } from './types'
import type { UserProfile } from '../auth/types'
import { extractEmailDomain } from '../teams/service'

export interface AuthzContext {
  user?: UserProfile
}

export function defineAbilityForUser(user?: UserProfile): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility)

  if (!user || user.status === 'suspended') {
    // Unauthenticated or suspended users have no protected permissions
    return build()
  }

  const verifiedEmails = user.emails
    .filter((e) => e.verifiedAt !== null)
    .map((e) => e.email.toLowerCase())

  const verifiedDomains = Array.from(
    new Set(
      verifiedEmails
        .map((e) => extractEmailDomain(e))
        .filter((d): d is string => Boolean(d)),
    ),
  )

  // 1. User Profile permissions
  can('read', 'User')
  can('update', 'User', { id: user.id })

  // 2. Team permissions
  can('create', 'Team')

  // Read team: if user is member OR (domain team and user has verified email for that domain)
  can('read', 'Team', { 'members.userId': user.id })
  if (verifiedDomains.length > 0) {
    can('read', 'Team', { type: 'domain', domain: { $in: verifiedDomains } })
  }

  // Manage private team (invite members, remove members, edit team settings):
  // Allowed if user is admin in the private team
  can('manage', 'Team', {
    type: 'private',
    members: { $elemMatch: { userId: user.id, role: 'admin' } },
  })

  // Expel member from domain team: any member of that domain team
  can('expel', 'Team', {
    type: 'domain',
    'members.userId': user.id,
  })

  // Leave team: any active member
  can('leave', 'Team', {
    'members.userId': user.id,
  })

  // 3. Team Invitations permissions
  // Recipient can accept or reject
  can('accept', 'TeamInvitation', { status: 'pending', targetUsername: user.username })
  can('reject', 'TeamInvitation', { status: 'pending', targetUsername: user.username })
  if (verifiedEmails.length > 0) {
    can('accept', 'TeamInvitation', { status: 'pending', targetEmail: { $in: verifiedEmails } })
    can('reject', 'TeamInvitation', { status: 'pending', targetEmail: { $in: verifiedEmails } })
  }

  return build({
    detectSubjectType: (item: any) => {
      if (typeof item === 'string') return item as any
      if (item && typeof item === 'object') {
        if ('__type' in item) return item.__type
        if ('targetUsername' in item || 'invitedBy' in item) return 'TeamInvitation'
        if ('type' in item && ('domain' in item || 'members' in item || item.type === 'private' || item.type === 'domain')) return 'Team'
        if ('emails' in item && 'username' in item) return 'User'
      }
      return 'all' as any
    },
  })
}
