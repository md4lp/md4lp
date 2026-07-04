import { defineConfig } from 'vitest/config'

// Default test environment is node (canonicalizer, pure logic).
// Editor tests opt into jsdom with a `// @vitest-environment jsdom` pragma at the top of the file.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/test/**/*.test.ts'],
  },
})
