import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const coreSrc = fileURLToPath(new URL('./packages/core/src/', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@llm-memory\/core$/, replacement: coreSrc + 'index.ts' },
      { find: /^@llm-memory\/core\/(.*)$/, replacement: coreSrc + '$1' },
    ],
  },
  test: { include: ['tests/**/*.test.ts'] },
})
