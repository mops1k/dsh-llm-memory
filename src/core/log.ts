/**
 * Chronological operation journal (`log.md`) plus a diagnostic debug log.
 *
 * The journal keeps one grep-friendly line per mutation:
 * `## [2026-09-06T12:00:00Z] <operation> | <title> (id: m_xxx)`.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Environment variable that enables the diagnostic log. */
export const DEBUG_ENV = 'DSH_LLM_MEMORY_DEBUG'

/** Absolute path of the wiki journal. */
export function logPath(memoryRoot: string): string {
  return join(memoryRoot, 'log.md')
}

/** Diagnostic append (enabled with `DSH_LLM_MEMORY_DEBUG=1`). */
export function debug(message: string): void {
  const flag = process.env[DEBUG_ENV]
  if (flag === undefined || flag === '0' || flag.toLowerCase() === 'false') return
  try {
    appendFileSync(join(tmpdir(), 'dsh-llm-memory-debug.log'), `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {
    /* ignore */
  }
}

/** Append one operation line to the journal. */
export function appendLog(memoryRoot: string, operation: string, title: string, id?: string): void {
  try {
    if (!existsSync(memoryRoot)) mkdirSync(memoryRoot, { recursive: true })
    const stamp = new Date().toISOString()
    const suffix = id ? ` (id: ${id})` : ''
    appendFileSync(logPath(memoryRoot), `## [${stamp}] ${operation} | ${title}${suffix}\n`, 'utf8')
  } catch {
    /* ignore */
  }
}
