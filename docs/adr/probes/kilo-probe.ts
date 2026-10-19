// Диагностический плагин для спайков A2/A4/A7/A10/A15.
// Временный: после прогона удаляется из ~/.config/kilo/plugin/.
// Ничего не пишет в память Kilo, кроме своего отчёта ~/.config/kilo/kilo-probe-report.json.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { connect } from "node:net"
import { tool } from "@kilocode/plugin/tool"
import type { Hooks, Plugin, ToolDefinition } from "@kilocode/plugin"

const REPORT = join(homedir(), ".config", "kilo", "kilo-probe-report.json")
const report: Record<string, any> = {
  at: new Date().toISOString(),
  runtime: {},
  sqlite: null,
  onnx: null,
  ports: {},
  transforms: {},
  sessions: [],
}

function flush(): void {
  try {
    mkdirSync(dirname(REPORT), { recursive: true })
    writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8")
  } catch {
    /* отчёт — не критично */
  }
}

function runtimeFacts(directory: string, worktree: string): void {
  report.runtime = {
    bun: typeof Bun !== "undefined" ? Bun.version : null,
    node: process.version,
    platform: process.platform,
    directory,
    worktree,
    directoryIsUnc: /^\\\\[^\\]+\\[^\\]+/.test(directory ?? ""),
    worktreeResolved: (worktree ?? "") !== "/",
    pluginLoaded: true,
  }
}

async function dbProbe(label: string, file: string, out: Record<string, any>): Promise<void> {
  const { Database } = await import("bun:sqlite")
  for (const s of ["", "-wal", "-shm"]) {
    try {
      rmSync(file + s)
    } catch {
      /* нет файла */
    }
  }
  const db = new Database(file)
  db.exec("PRAGMA journal_mode=WAL")
  out[label + "Journal"] = db.prepare("PRAGMA journal_mode").get()?.journal_mode ?? null
  out[label + "LoadExtension"] = typeof (db as any).loadExtension
  db.exec("CREATE TABLE t(x TEXT)")
  db.prepare("INSERT INTO t VALUES (?)").run("кириллица тест")
  out[label + "Rows"] = db.prepare("SELECT COUNT(*) n FROM t").get()?.n ?? null
  db.close()
  for (const s of ["", "-wal", "-shm"]) {
    try {
      rmSync(file + s)
    } catch {
      /* уже удалено */
    }
  }
}

async function sqliteProbe(directory: string, worktree: string): Promise<void> {
  const res: Record<string, any> = {}
  try {
    await dbProbe("local", join(tmpdir(), "kilo-probe-local.db"), res)
  } catch (e) {
    res.localError = String(e)
  }
  const uncSource = /^(\\\\[^\\]+\\[^\\]+)/.exec(worktree ?? "") ? worktree : directory
  const m = /^(\\\\[^\\]+\\[^\\]+)/.exec(uncSource ?? "")
  if (m) {
    try {
      await dbProbe("unc", join(m[1], "tmp", "kilo-probe-unc.db"), res)
    } catch (e) {
      res.uncError = String(e)
    }
  } else {
    res.uncSkipped = "ни worktree, ни directory не UNC"
  }
  res.sqliteVecModule = existsSync(join(homedir(), ".config", "kilo", "node_modules", "sqlite-vec"))
  res.transformersModule = existsSync(join(homedir(), ".config", "kilo", "node_modules", "@huggingface", "transformers"))
  report.sqlite = res
}

async function onnxProbe(): Promise<void> {
  try {
    await import("@huggingface/transformers")
    report.onnx = "resolvable"
  } catch (e) {
    report.onnx = String(e).slice(0, 160)
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = connect({ host: "127.0.0.1", port })
    s.setTimeout(400)
    s.once("connect", () => {
      s.destroy()
      resolve(false)
    })
    s.once("error", () => resolve(true))
    s.once("timeout", () => {
      s.destroy()
      resolve(true)
    })
  })
}

async function portsProbe(): Promise<void> {
  for (const p of [8787, 8788, 8789, 8790]) report.ports[p] = (await portFree(p)) ? "free" : "busy"
}

const MARKER = "[[kilo-probe:v1]]"

const server: Plugin = async ({ directory, worktree }) => {
  runtimeFacts(directory ?? "", worktree ?? "")

  // Спайк A4: сам факт загрузки этого файла загрузчиком Kilo + регистрация инструмента.
  const tools: Record<string, ToolDefinition> = {
    probe_report: tool({
      description: "Диагностика kilo-probe: вернуть отчёт спайков (только чтение).",
      args: {},
      async execute() {
        return JSON.stringify(report)
      },
    }),
  }

  const hooks: Hooks = {
    // Спайк A7: сохраняется ли вставленный в system блок между вызовами transform
    // (то есть кэшируется ли промпт в рамках sessionID).
    "experimental.chat.system.transform": async (
      input: { sessionID?: string },
      output: { system: string[] },
    ) => {
      const sid = input.sessionID ?? "unknown"
      const t = (report.transforms[sid] ??= { calls: 0, markerPersisted: 0, lens: [] as number[] })
      t.calls += 1
      const joined = (output.system ?? []).join("\n")
      if (joined.includes(MARKER)) t.markerPersisted += 1
      else output.system = [...(output.system ?? []), MARKER]
      t.lens.push(joined.length)
      flush()
    },
  }

  // Спайки A2/A10/A15 выполняются один раз и не блокируют старт Kilo.
  void (async () => {
    try {
      await sqliteProbe(directory ?? "", worktree ?? "")
      await onnxProbe()
      await portsProbe()
      flush()
    } catch (e) {
      report.probeError = String(e)
      flush()
    }
  })()

  return {
    tool: tools,
    ...hooks,
    event: async ({ event }: { event: { type: string; properties?: { sessionID?: string } } }) => {
      if (event.type === "session.created") {
        report.sessions.push(event.properties?.sessionID ?? "?")
        flush()
      }
    },
    dispose: async () => {
      flush()
    },
  }
}

export default { id: "kilo-probe", server }
