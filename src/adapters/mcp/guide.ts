/**
 * Agent-facing guide for MCP hosts (plan §15.5).
 *
 * MCP gives no system-prompt hook, so the server ships the same rules as the
 * native adapters twice: as `instructions` of `initialize`, as the
 * `memory-guide` prompt and as the `memory://guide` resource.
 *
 * @module dsh-llm-memory/adapters/mcp/guide
 */
export const MCP_GUIDE = [
  '## Long-term memory (LLM Memory)',
  '',
  'This host has no memory hook: read this guide when a task starts and use the tools yourself.',
  'llm_memory_recall — search project and user memory; call it before answering when the answer depends on earlier decisions, rules, preferences or project facts. An empty query returns the most important active entries.',
  'llm_memory_save — store durable knowledge immediately: confirmed facts, decisions with reasoning, rules and preferences. Never save guesses, work-in-progress state or secrets; one entry is one fact and must read without context.',
  'llm_memory_forget — soft-delete (superseded); the page and its history stay on disk. Prefer it over delete when knowledge is outdated.',
  'llm_memory_delete — hard delete, only on an explicit request. Over HTTP it is disabled unless the server was started with --allow-delete.',
  'llm_memory_status, llm_memory_lint, llm_memory_graph — store state, integrity report and the memory graph.',
  'llm_memory_backup — create, list and verify .llmmem archives; restore and delete stay user-only (CLI or the web panel).',
  '',
  'Scope: one client id = one store. Project entries are scoped by the `project` argument (or by the project root the server was started for); user/global entries are shared by the projects of this client. A store never contains another harness\'s memory.',
].join('\n')

/** Prompt name and resource URI that expose the same text. */
export const MCP_GUIDE_PROMPT = 'memory-guide'
export const MCP_GUIDE_RESOURCE = 'memory://guide'
