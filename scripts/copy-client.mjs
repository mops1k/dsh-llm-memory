/**
 * Build helper: copy the authoritative `client/client.js` browser bundle to
 * `lib/client.js`, which is what `exports["./client"]` points at. The client is
 * plain classic JS (no JSX, no bundler), so tsc only compiles `src/**` and this
 * step places the file the dsh client actually loads.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../client/client.js', import.meta.url))
const styles = fileURLToPath(new URL('../client/panel-styles.js', import.meta.url))
const target = fileURLToPath(new URL('../lib/client.js', import.meta.url))

mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, `${readFileSync(styles, 'utf8')}\n${readFileSync(source, 'utf8')}`)
console.log(`[dsh-llm-memory] copied client bundle -> ${target}`)
