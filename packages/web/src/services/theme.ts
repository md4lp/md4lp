export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_STORAGE_KEY = 'md4lp_theme_preference'

export class ThemeManager {
  private static instance: ThemeManager
  private currentTheme: ThemeMode = 'system'

  private constructor() {
    let saved: ThemeMode = 'system'
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        saved = (window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode) || 'system'
      }
    } catch {}

    this.setTheme(saved, false)

    if (typeof window !== 'undefined' && window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.currentTheme === 'system') {
          this.applyThemeToDom()
        }
      })
    }
  }

  static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager()
    }
    return ThemeManager.instance
  }

  getTheme(): ThemeMode {
    return this.currentTheme
  }

  setTheme(theme: ThemeMode, persist = true): void {
    this.currentTheme = theme
    if (persist) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(THEME_STORAGE_KEY, theme)
        }
      } catch {}
    }
    this.applyThemeToDom()
  }

  private applyThemeToDom(): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (!root) return
    if (this.currentTheme === 'system') {
      root.removeAttribute('data-theme')
    } else {
      root.setAttribute('data-theme', this.currentTheme)
    }
  }
}

export const themeManager = ThemeManager.getInstance()
