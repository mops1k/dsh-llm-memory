/** Agent-facing guide injected into the OpenCode system prompt (ADR-003 names). */
export const OPENCODE_GUIDE = [
  '## Long-term memory (LLM Memory)',
  'llm_memory_recall — search project and user memory; call it when the answer depends on earlier decisions, rules, preferences or project facts.',
  'llm_memory_save — store confirmed facts, decisions with reasoning and rules; never save guesses, work-in-progress state or secrets.',
  'llm_memory_forget — soft-mark an entry as outdated; llm_memory_delete removes it permanently, only on an explicit request.',
  'llm_memory_status, llm_memory_lint, llm_memory_graph — store state, integrity report and the memory graph.',
].join('\n')
