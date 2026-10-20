import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const coreSrc = fileURLToPath(new URL('./src/core/', import.meta.url))
const uiSrc = fileURLToPath(new URL('./src/ui/', import.meta.url))
const testkitSrc = fileURLToPath(new URL('./src/testkit/', import.meta.url))
const adapterSrc = fileURLToPath(new URL('./src/adapters/', import.meta.url))

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
