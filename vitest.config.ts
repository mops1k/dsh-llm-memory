import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const coreSrc = fileURLToPath(new URL('./packages/core/src/', import.meta.url))
const uiSrc = fileURLToPath(new URL('./packages/ui/src/', import.meta.url))
const testkitSrc = fileURLToPath(new URL('./packages/testkit/src/', import.meta.url))
const adapterSrc = fileURLToPath(new URL('./packages/adapter/src/', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@llm-memory\/core$/, replacement: coreSrc + 'index.ts' },
      { find: /^@llm-memory\/core\/(.*)$/, replacement: coreSrc + '$1' },
      { find: /^@llm-memory\/ui$/, replacement: uiSrc + 'index.ts' },
      { find: /^@llm-memory\/ui\/(.*)$/, replacement: uiSrc + '$1' },
      { find: /^@llm-memory\/testkit$/, replacement: testkitSrc + 'index.ts' },
      { find: /^@llm-memory\/adapter\/(.*)$/, replacement: adapterSrc + '$1' },
    ],
  },
  test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] },
})
