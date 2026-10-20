/**
 * Build the OpenCode plugin bundle: one self-contained ESM file the host loads
 * from ~/.config/opencode/plugins/. The SDK and the embedding runtime are
 * resolved at runtime from the config directory, never bundled.
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../src/adapters/opencode/plugin.ts', import.meta.url))
const outfile = fileURLToPath(new URL('../lib/opencode.js', import.meta.url))

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  sourcemap: true,
  logLevel: 'info',
  external: ['@huggingface/transformers', 'sqlite-vec'],
})
console.log(`[llm-memory] opencode bundle -> ${outfile}`)
