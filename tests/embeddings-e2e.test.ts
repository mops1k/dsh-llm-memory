/**
 * End-to-end check of the real multilingual model.
 *
 * It downloads ~120 MB from the Hugging Face Hub on first use, so it is skipped
 * unless `DSH_LLM_MEMORY_E2E_EMBEDDINGS=1` (set `DSH_LLM_MEMORY_MODEL_CACHE` to
 * reuse a cache directory). Everything else in the suite uses a fake provider.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { mergeConfig } from '@llm-memory/core/config'
import { LocalEmbeddingProvider } from '@llm-memory/core/embeddings'
import { MemoryEngine } from '@llm-memory/core/engine'

const enabled = process.env['DSH_LLM_MEMORY_E2E_EMBEDDINGS'] === '1'
const cacheDir = process.env['DSH_LLM_MEMORY_MODEL_CACHE'] ?? join(tmpdir(), 'dsh-llm-memory-models')

describe.skipIf(!enabled)('local embeddings (end to end)', () => {
  it(
    'embeds Russian text and ranks the semantic neighbour first',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'llm-memory-e2e-'))
      const config = mergeConfig({ storageRoot: root }).embeddings
      const provider = new LocalEmbeddingProvider(config, { cacheDir, inline: true })
      const engine = new MemoryEngine({
        storageRoot: root,
        project: 'demo',
        manualEmbeddings: true,
        embeddingProvider: provider,
        config: { embeddings: { provider: 'local', chunkChars: 800, chunkOverlap: 120 } },
      })
      try {
        const target = engine.save({
          title: 'dsh-llm-memory: инкрементальный индекс',
          text: 'Fingerprint size+mtime и reconcileFromDisk вместо полного reindex в heal.',
        })
        engine.save({
          title: 'Язык общения с Александром',
          text: 'Александр общается по-русски, ответы и записи только на русском языке.',
        })
        engine.save({
          title: 'Автосжатие контекста в пресете standard',
          text: 'thresholdRatio 0.04 и retainTokens 15000 вместо дефолтных 800k.',
        })

        await engine.embedPending()
        const status = engine.vectorStatus()
        expect(status?.entries).toBe(3)
        expect(status?.chunks).toBeGreaterThanOrEqual(3)

        const batch = await provider.embed(['тест'], 'query')
        expect(batch.dim).toBe(384)
        expect(batch.vectors[0]).toHaveLength(384)
        const vector = batch.vectors[0]!
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
        expect(norm).toBeCloseTo(1, 3)

        // The lexical leg cannot connect "ускорить переиндексацию" with the
        // stored "fingerprint"/"reconcileFromDisk" wording; the vector leg can.
        const result = await engine.recall('как ускорить переиндексацию памяти')
        expect(result.items[0]?.id).toBe(target.id)
      } finally {
        engine.close()
        rmSync(root, { recursive: true, force: true })
      }
    },
    300_000,
  )
})
