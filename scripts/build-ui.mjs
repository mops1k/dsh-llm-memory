/**
 * Build the shared web bundle for the web hosts (Kilo/OpenCode/MCP).
 * React is inlined so a host only serves one file.
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../packages/ui/src/web/mount.tsx', import.meta.url))
const outfile = fileURLToPath(new URL('../packages/ui/lib/web.js', import.meta.url))

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'transform',
  sourcemap: true,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
})
console.log(`[llm-memory] web bundle -> ${outfile}`)
