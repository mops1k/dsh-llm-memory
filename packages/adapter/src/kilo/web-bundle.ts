/**
 * The shared web bundle is embedded into the single-file Kilo plugin at build
 * time (`scripts/build-kilo.mjs`), so the panel works without shipping sibling
 * files next to `kilo-memory.js`.
 */
declare const __LLM_MEMORY_WEB_BUNDLE__: string | undefined

export function embeddedWebBundle(): string | null {
  return typeof __LLM_MEMORY_WEB_BUNDLE__ === 'string' && __LLM_MEMORY_WEB_BUNDLE__.length > 0
    ? __LLM_MEMORY_WEB_BUNDLE__
    : null
}
