#!/usr/bin/env node
/**
 * Zero-dependency host for the prototype.
 *
 *   node src/ui/design/panel/server.mjs                 # demo data (default)
 *   node src/ui/design/panel/server.mjs --port 4173
 *   node src/ui/design/panel/server.mjs --api http://127.0.0.1:3080/llm-memory/api
 *
 * With `--api` the page runs against the real DSH HTTP surface through the
 * same-origin `/api/*` proxy (DSH has no CORS headers), which is what the
 * "Live" badge in the top bar means. Without it the page renders the demo
 * transport and never touches a real store.
 */
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)))

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const port = Number(arg('--port', process.env.PORT ?? '4173'))
const host = arg('--host', '127.0.0.1')
const apiBase = arg('--api', process.env.LM_API ?? '').replace(/\/+$/, '')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

/** Inject the host facts the page needs (same shape the real panel host uses). */
function injectConfig(res, html) {
  const config = { mode: apiBase ? 'live' : 'demo', apiBase: '/api', source: apiBase || null }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(html.replace('<!--LM_PROTOTYPE_CONFIG-->', `<script>window.__LM_PROTOTYPE__ = ${JSON.stringify(config)}</script>`))
}

async function proxy(req, res, url) {
  const target = `${apiBase}${url.pathname.slice('/api'.length)}${url.search}`
  const headers = { ...req.headers, host: new URL(apiBase).host }
  delete headers.origin
  delete headers.referer
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : req
  try {
    const upstream = await fetch(target, { method: req.method, headers, body, duplex: body ? 'half' : undefined })
    const text = await upstream.text()
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(text)
  } catch (error) {
    sendJson(res, 502, { error: `live API unreachable: ${error instanceof Error ? error.message : String(error)}` })
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? host}`)
  if (apiBase && url.pathname.startsWith('/api/')) return proxy(req, res, url)

  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/' || pathname === '') pathname = '/index.html'
  if (pathname.endsWith('/')) pathname += 'index.html'
  if (pathname.startsWith('/fixtures/') || pathname.startsWith('/js/') || pathname.startsWith('/styles/')) {
    const file = normalize(join(root, pathname))
    if (!file.startsWith(root + sep)) return sendJson(res, 403, { error: 'forbidden' })
    try {
      if (!statSync(file).isFile()) throw new Error('not a file')
      if (extname(file) === '.html') {
        const html = await import('node:fs').then(fs => fs.readFileSync(file, 'utf8'))
        return injectConfig(res, html)
      }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      createReadStream(file).pipe(res)
    } catch {
      sendJson(res, 404, { error: 'not found' })
    }
    return
  }

  if (pathname === '/index.html') {
    const fs = await import('node:fs')
    return injectConfig(res, fs.readFileSync(join(root, 'index.html'), 'utf8'))
  }

  sendJson(res, 404, { error: 'not found' })
})

server.listen(port, host, () => {
  const mode = apiBase ? `live → ${apiBase}` : 'demo data'
  console.log(`LLM Memory panel prototype: http://${host}:${port}/  (${mode})`)
})
