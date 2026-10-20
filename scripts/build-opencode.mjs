/**
 * Build the OpenCode plugin bundle (one file for OpenCode 1.x and 2.x): one self-contained ESM file the host loads
 * from ~/.config/opencode/plugins/. The SDK and the embedding runtime are
 * resolved at runtime from the config directory, never bundled.
 */
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../src/adapters/opencode/plugin-dual.ts', import.meta.url))
const outfile = fileURLToPath(new URL('../lib/opencode.js', import.meta.url))
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
  external: ['@huggingface/transformers', 'sqlite-vec', '@opencode-ai/plugin'],
  define: {
    __LLM_MEMORY_LEGACY_HTML__: JSON.stringify(legacyHtml),
  },
})
console.log(`[llm-memory] opencode bundle -> ${outfile}`)
