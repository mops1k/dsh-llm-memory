/**
 * Backfill the vector index of a Kilo store (acceptance and first run).
 *
 * Unlike `e2e-kilo-rag.ts` this touches only the vector table: it embeds the
 * pages into `memory_vectors` and reports the queue/health, without any recall
 * that would reinforce entries and rewrite pages. `KILO_STORE` names the store;
 * the model cache is `<store>/_models`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { resolveKiloConfig } from '../src/adapters/kilo/config.js'
import { KiloService } from '../src/adapters/kilo/service.js'

const store = (process.env['KILO_STORE'] ?? '').trim()
if (store.length === 0 || !existsSync(store)) {
  console.error('KILO_STORE must point at a Kilo store')
  process.exit(2)
}
const config = resolveKiloConfig({
  memory: { storageRoot: store, recallScope: 'all' },
  web: { enabled: false },
  embeddings: {
    provider: 'local',
    model: 'Xenova/multilingual-e5-small',
    dim: 384,
    topK: 50,
    minScore: 0.35,
    chunkChars: 800,
    chunkOverlap: 120,
    prewarm: false,
  },
})

const service = new KiloService({ config, manualEmbeddings: true })
const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`
try {
  service.init()
  const started = Date.now()
  await service.embedPending()
  const health = service.vectorHealth()
  console.log(
    JSON.stringify(
      {
        runtime,
        store,
        storeModels: join(store, '_models'),
        ms: Date.now() - started,
        entries: service.status().total,
        vectors: service.vectorStatus(),
        health: health
          ? {
              checked: health.checked,
              missing: health.missing.length,
              partial: health.partial.length,
              orphans: health.orphans.length,
              broken: health.broken.length,
            }
          : null,
        model: service.modelStatus(),
      },
      null,
      2,
    ),
  )
} finally {
  service.close()
}
