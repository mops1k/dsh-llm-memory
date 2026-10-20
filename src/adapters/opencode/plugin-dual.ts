/**
 * Single OpenCode plugin artifact that runs on both host generations.
 *
 * - OpenCode 1.x loads `~/.config/opencode/plugin/llm-memory.js` and calls
 *   `server(context)`, which returns the v1 hooks object.
 * - OpenCode 2.x loads `~/.config/opencode/plugins/llm-memory.js` and calls
 *   `setup(context)`, which registers tools and session hooks through the v2
 *   context.
 *
 * Each loader ignores the entry it does not know, so one bundle serves both.
 */
import v1Plugin from './plugin.js'
import v2Plugin from './plugin-v2.js'

const plugin = {
  id: 'llm-memory',
  server: v1Plugin.server,
  setup: v2Plugin.setup,
}

export default plugin
