/**
 * Build the Kilo plugin bundle: one self-contained ESM file the Kilo loader can
 * place into ~/.config/kilo/plugin/. The SDK is imported dynamically at runtime.
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../packages/adapter/src/kilo/plugin.ts', import.meta.url))
const outfile = fileURLToPath(new URL('../packages/adapter/lib/kilo.js', import.meta.url))

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  sourcemap: true,
  logLevel: 'info',
})
console.log(`[llm-memory] kilo bundle -> ${outfile}`)
