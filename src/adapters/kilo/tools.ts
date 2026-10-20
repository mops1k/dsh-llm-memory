/**
 * Kilo tool surface: the shared descriptors (ADR-003 names) wrapped by the Kilo
 * `tool()` helper at runtime. The plugin entry supplies the SDK.
 */
import {
  createMemoryTools,
  MEMORY_TOOL_NAMES,
  type MemoryTool,
  type ToolArg,
  type ToolArgType,
} from '../../core/application/tools.js'
import type { MemoryService } from '../../core/application/memory-service.js'

export type KiloTool = MemoryTool
export type { ToolArg, ToolArgType }
export const KILO_TOOL_NAMES = MEMORY_TOOL_NAMES

/** Shape of the Kilo `tool()` helper and its `schema` factory (subset we use). */
export interface KiloMemoryToolsSdk {
  (definition: { description: string; args: Record<string, unknown>; execute: (args: Record<string, unknown>) => Promise<string> }): unknown
  schema: {
    string(): unknown
    number(): unknown
    boolean(): unknown
    array(inner: unknown): unknown
    enum(values: string[]): unknown
  }
}

export function kiloMemoryTools(service: MemoryService): Record<string, KiloTool> {
  return createMemoryTools(service)
}
