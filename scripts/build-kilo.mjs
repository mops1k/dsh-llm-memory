/**
 * Build the Kilo plugin bundle: one self-contained ESM file the Kilo loader can
 * place into ~/.config/kilo/plugin/. The SDK is imported dynamically at runtime.
 */
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../src/adapters/kilo/plugin.ts', import.meta.url))
const outfile = fileURLToPath(new URL('../lib/kilo.js', import.meta.url))
const legacyHtml = readFileSync(fileURLToPath(new URL('../src/ui/design/panel.html', import.meta.url)), 'utf8')

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  sourcemap: true,
  logLevel: 'info',
  define: {
    __LLM_MEMORY_LEGACY_HTML__: JSON.stringify(legacyHtml),
  },
})
console.log(`[llm-memory] kilo bundle -> ${outfile}`)
