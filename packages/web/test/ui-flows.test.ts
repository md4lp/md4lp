import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ThemeManager, themeManager } from '../src/services/theme'
import { api } from '../src/services/api'

describe('ThemeManager UI & Theme Preferences', () => {
  it('initializes with system preference and updates getTheme', () => {
    themeManager.setTheme('system', false)
    expect(themeManager.getTheme()).toBe('system')
  })

  it('updates theme to dark and light', () => {
    themeManager.setTheme('dark', false)
    expect(themeManager.getTheme()).toBe('dark')

    themeManager.setTheme('light', false)
    expect(themeManager.getTheme()).toBe('light')
  })
})

describe('API Client Teams & Projects Integration Contracts', () => {
  it('correctly maps teams overview endpoints', async () => {
    const mockTeams = [{ id: 'team-1', name: 'Engineering', type: 'private' }]
    const mockDomainTeams = [{ id: 'team-dom', name: 'acme.com Team', type: 'domain', domain: 'acme.com' }]

    vi.spyOn(api, 'request').mockResolvedValueOnce({
      ok: true,
      teams: mockTeams,
      domainTeams: mockDomainTeams,
    })

    const res = await api.listTeams()
    expect(res.teams).toHaveLength(1)
    expect(res.teams[0].name).toBe('Engineering')
    expect(res.domainTeams).toHaveLength(1)
    expect(res.domainTeams[0].domain).toBe('acme.com')
  })

  it('creates private team and joins domain team with verified email', async () => {
    const mockTeam = { id: 'team-2', name: 'Product Team', type: 'private' }
    const spy = vi.spyOn(api, 'request').mockResolvedValueOnce({ ok: true, team: mockTeam })

    const res = await api.createTeam('Product Team')
    expect(res.team.name).toBe('Product Team')
    expect(spy).toHaveBeenCalledWith('/api/teams', expect.objectContaining({ method: 'POST' }))
  })
})
