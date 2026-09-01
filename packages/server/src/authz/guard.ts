import { subject } from '@casl/ability'
import type { AppAbility, AppAction, AppSubject } from './types'

export class ForbiddenError extends Error {
  readonly status = 403
  constructor(message = 'Access denied: insufficient permissions') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export function assertCan(
  ability: AppAbility,
  action: AppAction,
  subj: AppSubject | { __type: string; [key: string]: any },
  customMessage?: string,
): void {
  const target = typeof subj === 'object' && subj !== null && '__type' in subj
    ? subject(subj.__type as any, subj)
    : subj

  if (!ability.can(action, target as any)) {
    throw new ForbiddenError(customMessage ?? `Access denied: cannot perform ${action} on this resource`)
  }
}
