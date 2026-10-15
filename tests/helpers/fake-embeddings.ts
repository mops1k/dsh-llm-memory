/**
 * Deterministic embedding provider for the vector tests.
 *
 * It maps word groups to dimensions, so the tests can prove the plumbing — the
 * index, the queue, the rank fusion, the graph and the excerpt mode — without a
 * model download. The real model is exercised by
 * `tests/embeddings-e2e.test.ts`, enabled with `DSH_LLM_MEMORY_E2E_EMBEDDINGS=1`.
 */
import type { EmbeddingBatch, EmbeddingProvider, EmbeddingRole } from '../../src/core/types'

/** Word groups: a text gets 1 in dimension i when it contains a word of group i. */
export const VOCABULARY: string[][] = [
  ['индекс', 'инкремент', 'переиндексац', 'fingerprint', 'reconcile'],
  ['язык', 'русск', 'language'],
  ['план', 'approval', 'согласован'],
]

/** Provider over a fixed vocabulary, normalized like the real one. */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'fake'
  readonly model = 'fake-vocab-3'
  readonly dim = VOCABULARY.length
  readonly ready = true
  embeddedCount = 0
  lastTexts: string[] = []

  async prewarm(): Promise<void> {}

  async embed(texts: string[], _role: EmbeddingRole): Promise<EmbeddingBatch> {
    this.embeddedCount += texts.length
    this.lastTexts = [...texts]
    const vectors = texts.map((text) => {
      const lower = text.toLowerCase()
      const values = VOCABULARY.map((group) => (group.some((word) => lower.includes(word)) ? 1 : 0))
      const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1
      return Float32Array.from(values.map((value) => value / norm))
    })
    return { vectors, model: this.model, dim: this.dim }
  }
}
