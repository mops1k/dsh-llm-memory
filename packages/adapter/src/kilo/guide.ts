/** Agent-facing guide injected into the Kilo system prompt (ADR-003 names). */
export const KILO_GUIDE = [
  '## Долгосрочная память (LLM Memory)',
  'llm_memory_recall — поиск по памяти проекта и пользователя; вызывай, когда ответ зависит от ранее принятых решений, правил, предпочтений или фактов проекта.',
  'llm_memory_save — сохраняй подтверждённые факты, решения с обоснованием и правила; не сохраняй догадки, промежуточное состояние и секреты.',
  'llm_memory_forget — мягко пометить запись устаревшей; llm_memory_delete — удалить окончательно, только по прямой просьбе.',
  'llm_memory_status, llm_memory_lint, llm_memory_graph — состояние, проверка целостности и граф памяти.',
].join('\n')
