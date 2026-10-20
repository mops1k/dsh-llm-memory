/**
 * OpenCode tool surface: shared `llm_memory_*` descriptors wrapped into OpenCode
 * `ToolDefinition`s with the SDK's own zod (`tool.schema`), so schemas belong to
 * the host's zod instance and its JSON-schema conversion.
 */
import {
  createMemoryTools,
  MEMORY_TOOL_NAMES,
  type ToolArg,
} from '../../core/application/tools.js'
import type { MemoryService } from '../../core/application/memory-service.js'

export const OPENCODE_TOOL_NAMES = MEMORY_TOOL_NAMES

/** Minimal schema shape of the OpenCode `tool()` helper (zod-compatible). */
export interface OpenCodeSchema {
  optional(): OpenCodeSchema
  describe(text: string): OpenCodeSchema
}

export interface OpenCodeToolsSdk {
  (definition: {
    description: string
    args: Record<string, OpenCodeSchema>
    execute(args: Record<string, unknown>, context: unknown): Promise<string>
  }): unknown
  schema: {
    string(): OpenCodeSchema
    number(): OpenCodeSchema
    boolean(): OpenCodeSchema
    array(inner: OpenCodeSchema): OpenCodeSchema
    enum(values: string[]): OpenCodeSchema
  }
}

function schemaFor(sdk: OpenCodeToolsSdk, arg: ToolArg): OpenCodeSchema {
  let schema: OpenCodeSchema
  if (arg.type === 'string') schema = arg.enum ? sdk.schema.enum([...arg.enum]) : sdk.schema.string()
  else if (arg.type === 'number') schema = sdk.schema.number()
  else if (arg.type === 'boolean') schema = sdk.schema.boolean()
  else schema = sdk.schema.array(sdk.schema.string())
  if (arg.description) schema = schema.describe(arg.description)
  if (arg.optional) schema = schema.optional()
  return schema
}

/** Wrap every shared tool into the host tool definition. */
export function openCodeMemoryTools(service: MemoryService, sdk: OpenCodeToolsSdk): Record<string, unknown> {
  const tools = createMemoryTools(service)
  const out: Record<string, unknown> = {}
  for (const [name, definition] of Object.entries(tools)) {
    const args: Record<string, OpenCodeSchema> = {}
    for (const [key, arg] of Object.entries(definition.args)) args[key] = schemaFor(sdk, arg)
    out[name] = sdk({
      description: definition.description,
      args,
      execute: async (input: Record<string, unknown>) => definition.execute(input),
    })
  }
  return out
}
