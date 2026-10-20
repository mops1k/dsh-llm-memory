/**
 * Build the MCP server bundle: one ESM file with a shebang, `lib/mcp.js`.
 *
 * The embedding runtime and sqlite-vec stay external (optional dependencies),
 * the panel page is embedded, and the package version is injected so
 * `serverInfo` matches the published package.
 */
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../src/adapters/mcp/cli.ts', import.meta.url))
const outfile = fileURLToPath(new URL('../lib/mcp.js', import.meta.url))
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const legacyHtml = readFileSync(fileURLToPath(new URL('../src/ui/design/panel.html', import.meta.url)), 'utf8')

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  external: ['@huggingface/transformers', 'sqlite-vec'],
  define: {
    __LLM_MEMORY_VERSION__: JSON.stringify(pkg.version),
    __LLM_MEMORY_LEGACY_HTML__: JSON.stringify(legacyHtml),
  },
})
console.log(`[llm-memory] mcp bundle -> ${outfile}`)
