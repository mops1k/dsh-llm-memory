/**
 * Dev helper: serve the DSH WebUI handler over a *copy* of a store so the new
 * headless UI can be exercised without touching a live harness.
 *
 *   node scripts/demo-dsh-server.mjs --store /tmp/dsh-demo [--port 8791]
 */
import { createServer } from 'node:http'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}
const store = flag('store')
const port = Number(flag('port', '8791'))
if (!store) {
  console.error('usage: node scripts/demo-dsh-server.mjs --store <dir> [--port 8791]')
  process.exit(2)
}

const { MemoryEngine } = await import('../lib/core/application/engine.js')
const { mergeConfig } = await import('../lib/core/domain/config.js')
const { createWebHandler } = await import('../lib/dsh/web.js')

const config = mergeConfig({ webPath: '', storageRoot: store })
const engine = new MemoryEngine({ storageRoot: store, config })
const handler = createWebHandler(engine, config, { storageRoot: store })

const server = createServer((req, res) => {
  Promise.resolve(handler(req, res)).catch(error => {
    res.statusCode = 500
    res.end(String(error))
  })
})
server.listen(port, '127.0.0.1', () => {
  console.log(`demo DSH UI on http://127.0.0.1:${port}/ui (store: ${store})`)
})
process.on('SIGTERM', () => { engine.close(); server.close(() => process.exit(0)) })
