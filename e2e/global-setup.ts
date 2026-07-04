import { rm } from 'node:fs/promises'
import { E2E_REPO } from '../playwright.config'

/**
 * Wipe the throwaway e2e repo before each run so the server reseeds the sample docs deterministically
 * (it seeds only when there's no .git). Runs before the webServer starts, so the fresh stack always
 * boots on a clean, known repo. Keeps e2e hermetic — no carry-over comments/branches between runs.
 */
export default async function globalSetup(): Promise<void> {
  console.log(`[global-setup] wiping e2e repo: ${E2E_REPO}`)
  await rm(E2E_REPO, { recursive: true, force: true })
}
