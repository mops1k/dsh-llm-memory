/**
 * System-prompt guidance, durable session hooks, session-start context
 * injection and the `memory` human command.
 *
 * Three host capabilities live here:
 * - an ordered system-prompt section built from `config.systemPrompt` plus a
 *   compact digest of active rules ({@link MemoryEngine.rulesForPrompt});
 * - a raw per-session digest that captures only user/assistant message text
 *   and flushes it atomically on compaction or shutdown;
 * - a short memory guide injected with `agent.inject()` when a session starts,
 *   plus the `/memory status|import|export` human command.
 *
 * @module dsh-llm-memory/dsh/context
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'

import type { MemoryConfig } from '../core/config.js'
import type { MemoryEngine } from '../core/engine.js'
import { detectImportProjects, mergeImportedProjects, runImport } from '../core/import/index.js'
import { DIGEST_DIR } from '../core/paths.js'
import { exportRulesToDshAgents } from './rules-export.js'
import { registerProjectRoots } from './workspaces.js'

/** Plugin name used as the injected-context source. */
const PLUGIN_NAME = 'dsh-llm-memory'

/** Unique name of the system-prompt section contributed by this plugin. */
const PROMPT_SECTION_NAME = 'llm-memory'

/** Sort order of the section; the persona keeps order 0. */
const PROMPT_SECTION_ORDER = 150

/** Short English guide injected once at session start. */
export const MEMORY_GUIDE = [
  'Long-term memory is available and autonomous.',
  '- Call llm_memory_recall before answering questions about preferences, decisions, project facts or earlier work.',
  '- Call llm_memory_save immediately after learning durable knowledge (facts, decisions, preferences, rules, architecture, constraints); set tier important or immutable yourself when warranted.',
  '- When the user changes a decision or preference, supersede or forget the outdated entry in the same turn.',
  '- Never ask the user for confirmation before saving, retiering, forgetting, superseding or deleting.',
].join('\n')

/** One captured message of a raw session digest. */
export interface DigestRecord {
  role: 'user' | 'assistant'
  time: number
  text: string
}

/** Describe an unknown thrown value for logging. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Log a warning through the Cordis logger, falling back to the console. */
function warnContext(ctx: Context, message: string): void {
  try {
    ctx.logger.warn(message)
  } catch {
    console.warn(`[dsh-llm-memory] ${message}`)
  }
}

/** Extract visible text from model-facing content blocks (reasoning excluded). */
export function contentText(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      const text = block.text.trim()
      if (text.length > 0) parts.push(text)
    }
  }
  return parts.join('\n')
}

/** Render one digest record as a markdown block. */
export function digestBlock(record: DigestRecord): string {
  return `## ${record.role} (${new Date(record.time).toISOString()})\n\n${record.text}\n`
}

/** Sanitize a session id into a safe digest file name. */
export function digestFileName(sessionId: string): string {
  const safe = (sessionId ?? '')
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
  return `${safe.length > 0 ? safe : 'session'}.md`
}

/**
 * In-memory accumulator for raw session digests.
 *
 * Markdown is appended message by message in memory and written atomically
 * (temp file + rename) on {@link flush}/{@link flushAll}. The writer only ever
 * stores user/assistant message text — never tool calls, results or injected
 * plugin context.
 */
export class MemoryDigest {
  private readonly dir: string
  private readonly buffers = new Map<string, string>()
  private readonly loaded = new Set<string>()

  constructor(
    root: string,
    private readonly warn: (message: string) => void = () => {},
  ) {
    this.dir = join(root, DIGEST_DIR)
  }

  /** Absolute path of a session's digest file. */
  path(sessionId: string): string {
    return join(this.dir, digestFileName(sessionId))
  }

  /** Append one message to the in-memory digest of a session. */
  append(sessionId: string, role: DigestRecord['role'], time: number, text: string): void {
    const value = (text ?? '').trim()
    if (value.length === 0) return
    const base = this.base(sessionId)
    const block = digestBlock({ role, time, text: value }).trimEnd()
    this.buffers.set(sessionId, base.length > 0 ? `${base}\n\n${block}` : block)
  }

  /** Current in-memory digest text of a session (empty before any append). */
  content(sessionId: string): string {
    return this.buffers.get(sessionId) ?? ''
  }

  /** Atomically write one session's digest; returns `false` when there is nothing to write. */
  flush(sessionId: string): boolean {
    const value = this.buffers.get(sessionId)
    if (value === undefined) return false
    try {
      mkdirSync(this.dir, { recursive: true })
      const target = this.path(sessionId)
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
      writeFileSync(tmp, `${value}\n`, 'utf8')
      renameSync(tmp, target)
      return true
    } catch (error) {
      this.warn(`Failed to flush the session digest for "${sessionId}": ${errorMessage(error)}`)
      return false
    }
  }

  /** Atomically write every buffered session digest. */
  flushAll(): void {
    for (const sessionId of [...this.buffers.keys()]) this.flush(sessionId)
  }

  /** Load a digest lazily, seeding the buffer from disk on first use. */
  private base(sessionId: string): string {
    if (this.loaded.has(sessionId)) return this.buffers.get(sessionId) ?? ''
    this.loaded.add(sessionId)
    const target = this.path(sessionId)
    let initial = ''
    if (existsSync(target)) {
      try {
        initial = readFileSync(target, 'utf8')
      } catch (error) {
        this.warn(`Failed to read the session digest "${target}": ${errorMessage(error)}`)
      }
    }
    const trimmed = initial.trimEnd()
    this.buffers.set(sessionId, trimmed)
    return trimmed
  }
}

/** Register the system-prompt section (its text is re-evaluated per assembly). */
function registerSystemPrompt(ctx: Context, engine: MemoryEngine, config: MemoryConfig): void {
  const section: PromptSection = {
    name: PROMPT_SECTION_NAME,
    order: PROMPT_SECTION_ORDER,
    text: () => {
      const parts: string[] = []
      const base = (config.systemPrompt ?? '').trim()
      if (base.length > 0) parts.push(base)
      try {
        const rules = engine.rulesForPrompt().trim()
        if (rules.length > 0) parts.push(rules)
      } catch (error) {
        warnContext(ctx, `rulesForPrompt() failed: ${errorMessage(error)}`)
      }
      return parts.join('\n\n')
    },
  }
  try {
    ctx.systemPrompt.section(section)
  } catch (error) {
    warnContext(ctx, `System-prompt section "${PROMPT_SECTION_NAME}" was not registered: ${errorMessage(error)}`)
  }
}

/** Subscribe to durable session events and keep a raw digest per session. */
function registerSessionDigest(ctx: Context, engine: MemoryEngine): void {
  const digest = new MemoryDigest(engine.root, (message) => warnContext(ctx, message))
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    try {
      const sessionId = String(session.id)
      if (event.type === 'user/message') {
        if (event.data.source.kind !== 'user') return
        digest.append(sessionId, 'user', event.time, contentText(event.data.content))
        return
      }
      if (event.type === 'assistant/message') {
        digest.append(sessionId, 'assistant', event.time, contentText(event.data.message.content))
        return
      }
      if (event.type.startsWith('compaction/')) digest.flush(sessionId)
    } catch (error) {
      warnContext(ctx, `Session digest hook failed: ${errorMessage(error)}`)
    }
  })
  ctx.effect(() => () => digest.flushAll())
}

/** Inject the short memory guide when an agent session starts. */
function registerSessionStartGuide(ctx: Context, enabled: boolean): void {
  if (!enabled) return
  ctx.on('agent/session-start', (payload: { agent: Agent }) => {
    try {
      payload.agent.inject(
        createUserMessage({
          content: [{ type: 'text', text: MEMORY_GUIDE }],
          source: { kind: 'plugin', plugin: PLUGIN_NAME },
        }),
      )
    } catch (error) {
      warnContext(ctx, `Failed to inject the memory guide: ${errorMessage(error)}`)
    }
  })
}

/** Compact one-line status used by the `memory status` subcommand. */
function statusText(engine: MemoryEngine): string {
  const report = engine.statusReport()
  return [
    `Memory status: ${report.total} entries (${report.active} active).`,
    `- root: ${report.root}`,
    `- database: ${report.dbPath}`,
  ].join('\n')
}

/**
 * Execute the `/memory` human command without sending anything to the model.
 *
 * @param invocation - the settled command invocation (raw input).
 * @param engine - engine used for status and import.
 * @param config - current config supplying the import roots.
 * @returns the command result rendered by the dispatching UI.
 */
export function runMemoryCommand(
  invocation: CommandInvocation,
  engine: MemoryEngine,
  config: MemoryConfig,
): CommandResult {
  const input = (invocation.rawInput ?? '').trim()
  const sub = (input.split(/\s+/u)[0] ?? '').toLowerCase()

  if (sub.length === 0 || sub === 'status') {
    return { kind: 'success', text: statusText(engine) }
  }

  if (sub === 'export') {
    try {
      const result = exportRulesToDshAgents(config)
      return {
        kind: 'success',
        text: `Exported ${result.bytes} bytes from ${result.sources.length} rule source(s) to ${result.target}.`,
      }
    } catch (error) {
      return { kind: 'error', text: `Rule export is not available yet: ${errorMessage(error)}` }
    }
  }

  if (sub === 'import') {
    try {
      const importConfig = {
        importRoots: config.importRoots,
        importAutoDetect: config.importAutoDetect,
      }
      registerProjectRoots(engine, detectImportProjects({ config: importConfig }))
      const reports = runImport({ store: engine.getStore(), config: importConfig })
      registerProjectRoots(engine, mergeImportedProjects(reports.map((report) => report.projects)))
      const text =
        reports
          .map((report) => `${report.source}: imported=${report.imported} updated=${report.updated} skipped=${report.skipped}`)
          .join('\n') || 'Nothing to import.'
      return { kind: 'success', text }
    } catch (error) {
      return { kind: 'error', text: `Memory import failed: ${errorMessage(error)}` }
    }
  }

  return { kind: 'error', text: `Unknown memory subcommand "${sub}". Use status, import or export.` }
}

/** Register the `/memory` human command when the commands service is present. */
function registerMemoryCommand(ctx: Context, engine: MemoryEngine, config: MemoryConfig): void {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['commands'], (commandCtx) => {
    try {
      commandCtx.commands.register({
        name: 'memory',
        description: 'Inspect dsh-llm-memory status, import memories or export rules.',
        input: { hint: 'status | import | export' },
        handler: (invocation) => runMemoryCommand(invocation, engine, config),
      })
    } catch (error) {
      warnContext(ctx, `Failed to register the "memory" command: ${errorMessage(error)}`)
    }
  })
}

/** Register the system-prompt section, durable session hooks and the command. */
export function registerMemoryContext(ctx: Context, engine: MemoryEngine, config: MemoryConfig): void {
  registerSystemPrompt(ctx, engine, config)
  registerSessionDigest(ctx, engine)
  registerSessionStartGuide(ctx, config.sessionStartGuide)
  registerMemoryCommand(ctx, engine, config)
}
