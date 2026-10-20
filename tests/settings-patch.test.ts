/**
 * Panel settings patches: panels build nested objects (`{embeddings:{provider}}`),
 * while the service speaks dotted paths. Both shapes must apply, and the reported
 * "unsupported" list must match what the panel renders as disabled.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveKiloConfig } from '@llm-memory/adapter/kilo/config'
import { KiloService } from '@llm-memory/adapter/kilo/service'
import { resolveOpenCodeConfig } from '@llm-memory/adapter/opencode/config'
import { OpenCodeService } from '@llm-memory/adapter/opencode/service'
import type { EmbeddingBatch, EmbeddingProvider, EmbeddingRole } from '@llm-memory/core/domain/types'

class StubProvider implements EmbeddingProvider {
  readonly id = 'stub'
  readonly model = 'stub-4'
  readonly dim = 4
  readonly ready = true
  async prewarm(): Promise<void> {}
  async embed(texts: string[], _role: EmbeddingRole): Promise<EmbeddingBatch> {
    return { vectors: texts.map(() => Float32Array.from([1, 0, 0, 0])), model: this.model, dim: this.dim }
  }
}

const roots: string[] = []
const services: Array<{ close(): void }> = []

afterEach(() => {
  for (const service of services.splice(0)) service.close()
})

function makeOpenCode(): OpenCodeService {
  const root = mkdtempSync(join(tmpdir(), 'llm-memory-settings-opencode-'))
  roots.push(root)
  const service = new OpenCodeService({
    config: resolveOpenCodeConfig({ memory: { storageRoot: root } }),
    embeddingProvider: new StubProvider(),
    manualEmbeddings: true,
  })
  service.init()
  services.push(service)
  return service
}

function makeKilo(): KiloService {
  const root = mkdtempSync(join(tmpdir(), 'llm-memory-settings-kilo-'))
  roots.push(root)
  const service = new KiloService({
    config: resolveKiloConfig({ memory: { storageRoot: root } }),
    embeddingProvider: new StubProvider(),
    manualEmbeddings: true,
  })
  service.init()
  services.push(service)
  return service
}

describe('panel settings patches', () => {
  it('applies a nested patch like the OpenCode panel sends', () => {
    const service = makeOpenCode()
    const result = service.applySettingsPatch({
      recallLimit: 7,
      embeddings: { provider: 'local', model: 'Xenova/multilingual-e5-small', topK: 5 },
    } as unknown as Record<string, unknown>)
    expect(result.unsupported).toEqual([])
    expect(result.applied.sort()).toEqual([
      'embeddings.model',
      'embeddings.provider',
      'embeddings.topK',
      'recallLimit',
    ])
    expect(service.modelStatus().provider).toBe('local')
    const values = service.settingsSnapshot().snapshot.values
    expect(values['recallLimit']).toBe(7)
    expect(values['embeddings.provider']).toBe('local')
    expect(values['embeddings.topK']).toBe(5)
  })

  it('applies the same nested patch on Kilo and keeps flat patches working', () => {
    const kilo = makeKilo()
    const nested = kilo.applySettingsPatch({ embeddings: { provider: 'local', dim: 384 } } as unknown as Record<string, unknown>)
    expect(nested.unsupported).toEqual([])
    expect(nested.applied.sort()).toEqual(['embeddings.dim', 'embeddings.provider'])
    const flat = kilo.applySettingsPatch({ 'embeddings.provider': 'off', backupDir: '' })
    expect(flat.unsupported).toEqual([])
    expect(flat.applied.sort()).toEqual(['backupDir', 'embeddings.provider'])
    expect(kilo.settingsSnapshot().snapshot.values['embeddings.provider']).toBe('off')
  })

  it('reports genuinely unsupported paths and matches the disabled list', () => {
    const service = makeOpenCode()
    const { unsupported } = service.settingsSnapshot()
    expect(unsupported).not.toContain('embeddings.provider')
    expect(unsupported).not.toContain('embeddings.model')
    expect(unsupported).not.toContain('embeddings.topK')
    expect(unsupported).not.toContain('storageRoot')
    expect(unsupported).not.toContain('backupDir')
    expect(unsupported).toContain('embeddings.backend')
    expect(unsupported).toContain('embeddings.quantization')
    expect(unsupported).toContain('recallFormat')
    expect(unsupported).toContain('projectRoots')

    const result = service.applySettingsPatch({ embeddings: { backend: 'sqlite-vec' }, projectRoots: ['/x'] })
    expect(result.applied).toEqual([])
    expect(result.unsupported.sort()).toEqual(['embeddings.backend', 'projectRoots'])
  })

  it('agrees with the panel schema: every schema field is either applied or disabled', () => {
    const service = makeOpenCode()
    const { snapshot, unsupported } = service.settingsSnapshot()
    const disabled = new Set(unsupported)
    const patch: Record<string, unknown> = {}
    for (const group of snapshot.groups) {
      for (const field of group.fields) {
        const parts = field.path.split('.')
        let node = patch
        for (let i = 0; i < parts.length - 1; i++) {
          if (typeof node[parts[i]] !== 'object') node[parts[i]] = {}
          node = node[parts[i]] as Record<string, unknown>
        }
        const value = field.type === 'boolean' ? false : field.type === 'number' ? 3 : field.type === 'select' ? (field.options?.[0]?.value ?? '') : field.type === 'list' ? [] : ''
        node[parts[parts.length - 1]] = value
      }
    }
    const result = service.applySettingsPatch(patch)
    expect(result.unsupported.sort()).toEqual([...unsupported].sort())
    expect(result.applied.length + result.unsupported.length).toBe(
      snapshot.groups.reduce((sum, group) => sum + group.fields.length, 0),
    )
    expect(result.unsupported.every(path => disabled.has(path))).toBe(true)
  })
})
