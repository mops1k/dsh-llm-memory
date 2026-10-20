/**
 * Performance baseline (этап 11): save/recall/backup on a 1k+ entry store.
 *
 * It measures the real core on the local disk (no model: `embeddings.provider`
 * stays `off`, so recall is the lexical leg; the vector leg is measured by
 * scripts/bench-vector.mjs). Results are printed as a markdown table and,
 * with `--json`, as machine-readable JSON.
 *
 *   npm run build && node scripts/perf-baseline.mjs [--entries 1200] [--queries 200] [--json]
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { MemoryEngine } from '../lib/core/application/engine.js'
import { mergeConfig } from '../lib/core/domain/config.js'
import { createBackup, restoreBackup, verifyBackup } from '../lib/core/infrastructure/backup.js'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}
const entries = Number(flag('entries', '1200'))
const queries = Number(flag('queries', '200'))
const asJson = argv.includes('--json')

function percentile(values, ratio) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor(ratio * sorted.length))
  return sorted[index]
}

function median(values) {
  return percentile(values, 0.5)
}

function round(value) {
  return Math.round(value * 10) / 10
}

const dir = mkdtempSync(join(tmpdir(), 'llm-perf-'))
const root = join(dir, 'store')
const backupDir = join(dir, 'backups')
const result = { entries, queries, save: {}, recall: {}, startup: {}, backup: {} }

try {
  const config = mergeConfig({})
  const engine = new MemoryEngine({ storageRoot: root, project: 'demo', config })

  // Fill the store; every entry is a realistic ~200-char page.
  const saveStart = performance.now()
  for (let index = 0; index < entries; index += 1) {
    engine.save({
      text:
        `perf entry ${index}: incremental index, fingerprint size+mtime, reconcile from disk, ` +
        `hybrid recall fusion bm25 vector metadata, project ${index % 17}, decision ${index * 7 % 97}`,
      title: `perf entry ${index}`,
      scope: index % 5 === 0 ? 'user' : 'project',
      kind: ['facts', 'decisions', 'rules', 'preferences'][index % 4],
    })
  }
  const saveMs = performance.now() - saveStart
  result.save = { count: entries, totalMs: round(saveMs), perEntryMs: round(saveMs / entries) }

  // Recall latency: warm leg, self-retrieval queries.
  const samples = []
  for (let index = 0; index < queries; index += 1) {
    const query = `perf entry ${(index * 13) % entries}`
    const started = performance.now()
    await engine.recall(query, { touch: false })
    samples.push(performance.now() - started)
  }
  result.recall = {
    samples: queries,
    p50Ms: round(median(samples)),
    p95Ms: round(percentile(samples, 0.95)),
    maxMs: round(Math.max(...samples)),
  }

  // Cold vs warm startup: a fresh engine (open + schema ensure) and the first
  // recall against an already built index.
  const coldStart = performance.now()
  const cold = new MemoryEngine({ storageRoot: root, project: 'demo', config })
  await cold.recall('perf entry 1', { touch: false })
  result.startup.coldOpenAndFirstRecallMs = round(performance.now() - coldStart)
  cold.close()
  const warmStart = performance.now()
  const warm = new MemoryEngine({ storageRoot: root, project: 'demo', config })
  await warm.recall('perf entry 2', { touch: false })
  result.startup.warmOpenAndFirstRecallMs = round(performance.now() - warmStart)
  warm.close()

  // Backup: create → verify → restore into a fresh store, compare counts.
  const target = {
    harness: 'dsh',
    storeDir: engine.getStore().root,
    dbPath: engine.getStore().dbPath,
    projectDirs: [],
    backupsDir: backupDir,
  }
  engine.close()
  const backupStart = performance.now()
  const report = createBackup(target)
  result.backup.createMs = round(performance.now() - backupStart)
  result.backup.bytes = statSync(report.archive).size

  const verifyStart = performance.now()
  const verified = verifyBackup(report.archive)
  result.backup.verifyMs = round(performance.now() - verifyStart)
  result.backup.verified = verified.ok

  const restoreRoot = join(dir, 'restored')
  const restoreStart = performance.now()
  restoreBackup({
    harness: 'dsh',
    storeDir: restoreRoot,
    dbPath: join(restoreRoot, 'db', 'memory.db'),
    projectDirs: [],
    backupsDir: join(dir, 'restored-backups'),
    archive: report.archive,
    confirm: 'RESTORE',
  })
  result.backup.restoreMs = round(performance.now() - restoreStart)

  const restored = new MemoryEngine({ storageRoot: restoreRoot, project: 'demo', config })
  result.backup.restoredEntries = restored.statusReport().total
  restored.close()
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (asJson) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} else {
  process.stdout.write(
    [
      '| Метрика | Значение |',
      '|---|---|',
      `| Записей в сторе | ${result.entries} |`,
      `| save, всего | ${result.save.totalMs} мс (${result.save.perEntryMs} мс/запись) |`,
      `| recall p50 / p95 / max (${result.recall.samples} запросов) | ${result.recall.p50Ms} / ${result.recall.p95Ms} / ${result.recall.maxMs} мс |`,
      `| cold open + первый recall | ${result.startup.coldOpenAndFirstRecallMs} мс |`,
      `| warm open + первый recall | ${result.startup.warmOpenAndFirstRecallMs} мс |`,
      `| backup create / verify / restore | ${result.backup.createMs} / ${result.backup.verifyMs} / ${result.backup.restoreMs} мс |`,
      `| размер архива | ${(result.backup.bytes / 1024 / 1024).toFixed(1)} МБ |`,
      `| записей после restore | ${result.backup.restoredEntries} |`,
    ].join('\n') + '\n',
  )
}
