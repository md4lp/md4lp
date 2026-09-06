// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { i18n, dictionaries, type SupportedLocale } from '../src/services/i18n'

describe('i18n Localization & Translation Parity Regression Suite', () => {
  let store: Record<string, string> = {}

  beforeEach(() => {
    store = {}
    const mockStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, val: string) => { store[key] = val },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { store = {} },
      length: 0,
      key: () => null,
    }
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true,
    })
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'localStorage', {
        value: mockStorage,
        writable: true,
        configurable: true,
      })
    }
  })

  function getKeysDeep(obj: Record<string, any>, prefix = ''): string[] {
    let keys: string[] = []
    for (const [key, value] of Object.entries(obj)) {
      const currentKey = prefix ? `${prefix}.${key}` : key
      if (typeof value === 'object' && value !== null) {
        keys = keys.concat(getKeysDeep(value, currentKey))
      } else {
        keys.push(currentKey)
      }
    }
    return keys.sort()
  }

  it('guarantees 100% key parity between English (en) and Spanish (es) dictionaries', () => {
    const enKeys = getKeysDeep(dictionaries.en)
    const esKeys = getKeysDeep(dictionaries.es)

    const missingInEs = enKeys.filter(k => !esKeys.includes(k))
    const missingInEn = esKeys.filter(k => !enKeys.includes(k))

    expect(missingInEs).toEqual([])
    expect(missingInEn).toEqual([])
    expect(enKeys.length).toBeGreaterThan(50)
  })

  it('guarantees no empty strings or undefined translations in either dictionary', () => {
    function assertNoEmptyValues(obj: Record<string, any>, path = '') {
      for (const [key, value] of Object.entries(obj)) {
        const fullPath = path ? `${path}.${key}` : key
        if (typeof value === 'object' && value !== null) {
          assertNoEmptyValues(value, fullPath)
        } else {
          expect(typeof value, `Expected ${fullPath} to be string`).toBe('string')
          expect((value as string).trim().length, `Expected ${fullPath} to be non-empty`).toBeGreaterThan(0)
        }
      }
    }

    assertNoEmptyValues(dictionaries.en, 'en')
    assertNoEmptyValues(dictionaries.es, 'es')
  })

  it('manages locale switching, subscriber notifications, and localStorage persistence', () => {
    i18n.setLocale('es')
    expect(i18n.getLocale()).toBe('es')
    expect(i18n.t.dashboard.newProject).toBe('Nuevo Proyecto')
    expect(globalThis.localStorage.getItem('md4lp_locale')).toBe('es')

    const listener = vi.fn()
    const unsubscribe = i18n.subscribe(listener)

    i18n.setLocale('en')
    expect(i18n.getLocale()).toBe('en')
    expect(i18n.t.dashboard.newProject).toBe('New Project')
    expect(globalThis.localStorage.getItem('md4lp_locale')).toBe('en')
    expect(listener).toHaveBeenCalledWith('en')

    // Setting same locale does not re-trigger listener
    listener.mockClear()
    i18n.setLocale('en')
    expect(listener).not.toHaveBeenCalled()

    // Unsubscribe works
    unsubscribe()
    i18n.setLocale('es')
    expect(listener).not.toHaveBeenCalled()
  })

  it('contains critical recent feature keys: export options, sign-out dialog, and filters', () => {
    for (const lang of ['en', 'es'] as SupportedLocale[]) {
      const dict = dictionaries[lang]
      // Export keys
      expect(dict.workspace.export).toBeDefined()
      expect(dict.workspace.downloadMarkdown).toBeDefined()
      expect(dict.workspace.exportHtml).toBeDefined()
      expect(dict.workspace.exportPdf).toBeDefined()

      // Sign out dialog keys
      expect(dict.common.confirmSignOut).toBeDefined()
      expect(dict.common.signOutDescription).toBeDefined()

      // Filter keys
      expect(dict.workspace.filters).toBeDefined()
      expect(dict.workspace.allTab).toBeDefined()
      expect(dict.workspace.commentsOnly).toBeDefined()
      expect(dict.workspace.suggestionsOnly).toBeDefined()
      expect(dict.workspace.activeFiltersTooltip).toBeDefined()
      expect(dict.workspace.noFiltersTooltip).toBeDefined()
    }
  })
})
