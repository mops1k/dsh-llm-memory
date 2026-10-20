/**
 * Acceptance run for RAG in Kilo (plan p_c7de70db394f, P6).
 *
 * Opens a COPY of a Kilo store with the real embedding model and does what the
 * plugin does on startup: build the vector leg, backfill the vectors, answer a
 * few queries with the hybrid (lexical + semantic) recall, draw the map and
 * rebuild the index. Prints one JSON report; it never touches the live store —
 * `KILO_STORE` must point at a copy.
 *
 * Usage:
 *   KILO_STORE=/path/to/store node <bundle>.mjs
 * The model cache is expected at `<store>/_models` (copied with the store).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { resolveKiloConfig } from '../src/adapters/kilo/config.js'
import { KiloService } from '../src/adapters/kilo/service.js'

const store = (process.env['KILO_STORE'] ?? '').trim()
if (store.length === 0 || !existsSync(store)) {
  console.error('KILO_STORE must point at a copied Kilo store')
  process.exit(2)
}
if (!existsSync(join(store, '_models'))) {
  console.error(`no model cache in ${store}/_models: copy it together with the store`)
  process.exit(2)
}

const config = resolveKiloConfig({
  memory: { storageRoot: store, promptMode: 'dynamic', recallFormat: 'markdown', recallScope: 'all' },
  web: { enabled: false },
  embeddings: {
    provider: 'local',
    model: 'Xenova/multilingual-e5-small',
    dim: 384,
    topK: 50,
    minScore: 0,
    chunkChars: 800,
    chunkOverlap: 120,
    prewarm: false,
  },
})

const service = new KiloService({ config, manualEmbeddings: true })
const report: Record<string, unknown> = { store, runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}` }

try {
  service.init()
  report['entries'] = service.status().total

  const backfillStarted = Date.now()
  await service.embedPending()
  report['backfillMs'] = Date.now() - backfillStarted
  report['vectors'] = service.vectorStatus()
  const health = service.vectorHealth()
  report['health'] = health
    ? {
        checked: health.checked,
        missing: health.missing.length,
        partial: health.partial.length,
        orphans: health.orphans.length,
        broken: health.broken.length,
        badDim: health.badDim.length,
      }
    : null

  const map = service.vectorsMap()
  report['map'] = map ? { entries: map.entries, chunks: map.chunks, points: map.points.length, model: map.model, backend: map.backend } : null

  const queries = ['как устроен инкрементальный индекс', 'правила коммитов', 'windows и пути', 'план этапа']
  const recalls: Array<Record<string, unknown>> = []
  for (const query of queries) {
    const started = Date.now()
    const result = await service.recall(query, { limit: 5 })
    recalls.push({
      query,
      ms: Date.now() - started,
      top: result.items.map((item) => ({
        id: item.id,
        title: item.title,
        legs: result.sources?.get(item.id) ?? [],
      })),
    })
  }
  report['recalls'] = recalls
  report['projectQuery'] = await service.projectQuery('как устроен инкрементальный индекс', 3)

  const rebuildStarted = Date.now()
  service.rebuildVectors()
  report['cleared'] = service.vectorStatus()
  await service.embedPending()
  report['rebuildMs'] = Date.now() - rebuildStarted
  report['afterRebuild'] = service.vectorStatus()
  report['afterRebuildHealth'] = service.vectorHealth()
} finally {
  service.close()
}

console.log(JSON.stringify(report, null, 2))
