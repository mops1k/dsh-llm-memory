/**
 * Build helper: copy the authoritative `client/client.js` browser bundle to
 * `lib/client.js`, which is what `exports["./client"]` points at. The client is
 * plain classic JS (no JSX, no bundler), so tsc only compiles `src/**` and this
 * step places the file the dsh client actually loads.
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../client/client.js', import.meta.url))
const target = fileURLToPath(new URL('../lib/client.js', import.meta.url))

mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
console.log(`[dsh-llm-memory] copied client bundle -> ${target}`)

// Shared headless web UI (packages/ui/lib/web.js) is served by the DSH WebUI.
const webSource = fileURLToPath(new URL('../packages/ui/lib/web.js', import.meta.url))
const webTarget = fileURLToPath(new URL('../lib/web-ui.js', import.meta.url))
copyFileSync(webSource, webTarget)
console.log(`[dsh-llm-memory] copied headless web UI -> ${webTarget}`)
