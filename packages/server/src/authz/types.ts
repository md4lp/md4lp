import type { MongoAbility, InferSubjects } from '@casl/ability'
import type { Team, TeamWithDetails, TeamInvitation } from '../teams/types'
import type { Project, ProjectWithDetails, ProjectInvitation } from '../projects/types'
import type { UserProfile } from '../auth/types'

export type AppAction =
  | 'manage' // all actions
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'write'
  | 'comment'
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
  | 'ProjectInvitation'
  | 'Document'
  | 'Comment'
  | InferSubjects<Team | TeamWithDetails | TeamInvitation | Project | ProjectWithDetails | ProjectInvitation | UserProfile>

export type AppAbility = MongoAbility<[AppAction, AppSubject]>

