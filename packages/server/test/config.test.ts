import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig, DEFAULT_CONFIG } from '../src/config'

describe('@md4lp/server config', () => {
  it('returns DEFAULT_CONFIG when no file exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'md4lp-cfg-'))
    const config = await loadConfig(join(dir, 'nonexistent.json'))
    expect(config).toEqual(DEFAULT_CONFIG)
  })

  it('parses a valid config file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'md4lp-cfg-'))
    const path = join(dir, 'md4lp.config.json')
    writeFileSync(path, JSON.stringify({
      port: 9000,
      users: {
        carol: { role: 'editor', email: 'carol@example.com' },
        dave: { role: 'commenter' },
      },
    }))
    const config = await loadConfig(path)
    expect(config.port).toBe(9000)
    expect(config.users['carol']?.role).toBe('editor')
    expect(config.users['carol']?.email).toBe('carol@example.com')
    expect(config.users['dave']?.role).toBe('commenter')
    expect(config.users['dave']?.email).toBeUndefined()
  })

  it('throws on malformed JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'md4lp-cfg-'))
    const path = join(dir, 'bad.json')
    writeFileSync(path, '{ not valid json }')
    await expect(loadConfig(path)).rejects.toThrow()
  })
})
