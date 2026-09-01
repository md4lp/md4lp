import type { MongoAbility, InferSubjects } from '@casl/ability'
import type { Team, TeamWithDetails, TeamInvitation } from '../teams/types'
import type { UserProfile } from '../auth/types'

export type AppAction =
  | 'manage' // all actions
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'invite'
  | 'expel'
  | 'leave'
  | 'accept'
  | 'reject'
  | 'revoke'
  | 'apply'
  | 'publish'

export type AppSubject =
  | 'all'
  | 'Team'
  | 'TeamInvitation'
  | 'User'
  | 'Project'
  | 'Document'
  | 'Comment'
  | InferSubjects<Team | TeamWithDetails | TeamInvitation | UserProfile>

export type AppAbility = MongoAbility<[AppAction, AppSubject]>
