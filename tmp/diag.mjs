import { openDatabase } from '../packages/core/lib/infrastructure/sqlite/index.js'
import { MemoryStore } from '../packages/core/lib/infrastructure/store.js'
import { rankItems, DEFAULT_RANKING, DEFAULT_RANKING_WEIGHTS } from '../packages/core/lib/application/ranking.js'
const src = openDatabase('/tmp/kilo-rehearsal/source/db/memory.db')
const rows = src.prepare("SELECT title, content FROM memories WHERE status='active' LIMIT 5").all()
const queries = rows.map(r => `${r.title} ${r.content}`.split(/\s+/).filter(w=>w.length>4).slice(0,3).join(' '))
const store = new MemoryStore({ storageRoot: '/tmp/kilo-rehearsal/migrated', dbPath: '/tmp/kilo-rehearsal/migrated/db/memory.db' })
store.open()
const lex = { ...DEFAULT_RANKING, weights: { ...DEFAULT_RANKING_WEIGHTS, age:0, imp:0, acc:0, conf:0, tier:0, kind:0, scope:0 } }
for (const q of queries) {
  const tokens = q.toLowerCase().split(/\W+/).filter(t=>t.length>2)
  const match = tokens.map(t=>`"${t.replace(/"/g,'""')}"*`).join(' OR ')
  let expected = []
  try { expected = src.prepare(`SELECT m.id AS id FROM memories_fts f JOIN memories m ON m.id=f.id WHERE memories_fts MATCH ? AND m.status='active' ORDER BY bm25(memories_fts) LIMIT 10`).all(match).map(r=>r.id) } catch (e) { expected = ['ERR '+e.message] }
  const raw = store.search(q, { status:'active', limit: 50 })
  const actual = rankItems(raw, q, lex).slice(0,10).map(e=>e.id)
  console.log(JSON.stringify({ q: q.slice(0,40), exp: expected.length, act: actual.length, inter: expected.filter(id=>actual.includes(id)).length, expIds: expected.slice(0,3), actIds: actual.slice(0,3) }, null, 0))
}
store.close(); src.close()
