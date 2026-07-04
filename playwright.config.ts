import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

/**
 * Playwright CLI config — visual/E2E smokes for the md4lp web app, driven from one `pnpm e2e` command
 * (one approval per run, headless bundled Chromium, auto-closed). This is the smoke net; vitest stays
 * the always-on primary. See WIP/md4lp/doc/md4lp.testing-and-playwright.md.
 *
 * Isolation: the run brings up its OWN full stack on dedicated ports (server 8788, web 5273) pointed at
 * a throwaway repo (E2E_REPO, cleaned in global-setup → reseeded fresh). So a developer's `pnpm dev`
 * (server 8787 / web 5173 / dev repo) can keep running untouched. reuseExistingServer:false guarantees
 * we never accidentally drive the dev stack.
 */

const E2E_WEB_PORT = 5273
const E2E_SERVER_PORT = 8788
export const E2E_REPO = fileURLToPath(new URL('./.e2e-repo', import.meta.url))

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // single repo writer (D18) — keep e2e serial too
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${E2E_WEB_PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: `http://localhost:${E2E_WEB_PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      MD4LP_PORT: String(E2E_SERVER_PORT),
      MD4LP_SERVER: `http://localhost:${E2E_SERVER_PORT}`,
      MD4LP_WEB_PORT: String(E2E_WEB_PORT),
      MD4LP_REPO: E2E_REPO,
      // Short edit-lock idle timeout so the takeover path (lock.spec) is exercised quickly (D20).
      MD4LP_LOCK_TIMEOUT_MS: '3000',
    },
  },
})
