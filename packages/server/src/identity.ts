import type { Author } from '@md4lp/repo'
import type { Config } from './config'

export interface Caller {
  user: string
  role: 'editor' | 'commenter'
  author: Author
}

/** Resolve the role and Author record for a given user name against the loaded config. */
export function resolveCaller(user: string, config: Config): Caller {
  const userConfig = config.users[user]
  const role = userConfig?.role ?? 'editor'
  const email = userConfig?.email ?? `${user}@md4lp.local`
  return { user, role, author: { name: user, email } }
}
