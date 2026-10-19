/**
 * Build the Kilo plugin bundle: one self-contained ESM file the Kilo loader can
 * place into ~/.config/kilo/plugin/. The SDK is imported dynamically at runtime.
 */
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../packages/adapter/src/kilo/plugin.ts', import.meta.url))
const outfile = fileURLToPath(new URL('../packages/adapter/lib/kilo.js', import.meta.url))
const webBundle = readFileSync(fileURLToPath(new URL('../packages/ui/lib/web.js', import.meta.url)), 'utf8')
const legacyHtml = readFileSync(fileURLToPath(new URL('../packages/adapter/src/kilo/web-ui.legacy.html', import.meta.url)), 'utf8')

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
    __LLM_MEMORY_WEB_BUNDLE__: JSON.stringify(webBundle),
    __LLM_MEMORY_LEGACY_HTML__: JSON.stringify(legacyHtml),
  },
})
console.log(`[llm-memory] kilo bundle -> ${outfile}`)
