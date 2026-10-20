/**
 * Build the per-harness release artifacts (release workflow and local checks).
 *
 * Each host gets its own file, so a user downloads exactly what the host loads:
 *
 *   dsh-llm-memory-<version>.tgz        npm package for DSH (plugin + client + rules)
 *   llm-memory-kilo-<version>.js        single Kilo plugin file
 *   llm-memory-opencode-<version>.js    single OpenCode plugin file (1.x and 2.x)
 *   llm-memory-mcp-<version>.js         standalone MCP server binary
 *   checksums.txt                       SHA-256 of every artifact
 *
 * Requires a finished `npm run build` (it never builds on its own, so a release
 * cannot silently ship a stale bundle).
 *
 *   npm run build && node scripts/build-release-artifacts.mjs [--out dist/release]
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const argv = process.argv.slice(2)
const outIndex = argv.indexOf('--out')
const outDir = resolve(root, outIndex >= 0 ? argv[outIndex + 1] : 'dist/release')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version

const bundles = [
  { source: join(root, 'lib/kilo.js'), name: `llm-memory-kilo-${version}.js`, executable: false },
  { source: join(root, 'lib/opencode.js'), name: `llm-memory-opencode-${version}.js`, executable: false },
  { source: join(root, 'lib/mcp.js'), name: `llm-memory-mcp-${version}.js`, executable: true },
]

for (const bundle of bundles) {
  if (!existsSync(bundle.source)) {
    throw new Error(`missing ${bundle.source}: run the build first (npm run build)`)
  }
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// DSH keeps the npm package: the bundle patch, the client and the rules live in it.
const packJson = JSON.parse(
  execFileSync('npm', ['pack', '--json', '--pack-destination', outDir], { cwd: root, encoding: 'utf8' }),
)
// npm 12 keys the report by package name; older npm returned an array.
const packEntry = Array.isArray(packJson) ? packJson[0] : Object.values(packJson)[0]
const tarball = packEntry?.filename
if (typeof tarball !== 'string' || !existsSync(join(outDir, tarball))) {
  throw new Error('npm pack did not produce a tarball')
}

for (const bundle of bundles) {
  const target = join(outDir, bundle.name)
  copyFileSync(bundle.source, target)
  if (bundle.executable) chmodSync(target, 0o755)
}

const artifacts = [...bundles.map(bundle => bundle.name), basename(tarball)].sort()
const lines = artifacts.map(name => {
  const digest = createHash('sha256').update(readFileSync(join(outDir, name))).digest('hex')
  return `${digest}  ${name}`
})
writeFileSync(join(outDir, 'checksums.txt'), `${lines.join('\n')}\n`, 'utf8')

console.log(`[llm-memory] release artifacts for ${version} -> ${outDir}`)
for (const name of artifacts) console.log(`  ${name}`)
console.log('  checksums.txt')
