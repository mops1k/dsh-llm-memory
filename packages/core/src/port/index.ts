/**
 * Ports of the memory core. `sqlite` is wired today; the rest are declared so
 * adapters depend on interfaces instead of host APIs (ADR-008).
 */
export * from './sqlite.js'

export interface ClockPort {
  now(): number
  isoNow(): string
}

export interface LoggerPort {
  debug(message: string): void
  warn(message: string): void
  error(message: string): void
}

export interface FsPort {
  readText(path: string): string | null
  writeTextAtomic(path: string, data: string): void
  exists(path: string): boolean
}

export interface ConfigPort<T> {
  load(): T
  save(config: T): void
}

export interface WorkerPort {
  create(url: URL, options?: unknown): unknown
  terminate(worker: unknown): void
}
