/**
 * Embedding runtime of the Kilo plugin: detection and explicit installation.
 *
 * The plugin ships as a single file and cannot bundle `@huggingface/transformers`
 * (native ONNX binaries, ~100 MB), so the package has to be resolvable from the
 * plugin directory (`<config>/node_modules`). This module answers "is it there?"
 * and installs it through npm when the user explicitly asks for the model —
 * never on startup, never behind their back (spike P4: it loads under Bun
 * 1.4.3 on Windows from the store cache, offline).
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** Package that provides the ONNX embedding runtime. */
export const EMBEDDING_RUNTIME_PACKAGE = '@huggingface/transformers'

/** npm spec installed when the runtime is missing. */
export const EMBEDDING_RUNTIME_SPEC = `${EMBEDDING_RUNTIME_PACKAGE}@^4.3.1`

/** State of the embedding runtime shown by the model tab. */
export interface EmbeddingRuntimeStatus {
  /** Whether the plugin can resolve the package right now. */
  present: boolean
  /** Whether an installation is running. */
  installing: boolean
  /** Message of the last failed installation, or null. */
  error: string | null
  /** `node_modules` the package is resolved from. */
  dir: string
  /** Command a user can run by hand when the automatic install fails. */
  command: string
}

/** How the installer is driven; tests inject their own runner. */
export type RuntimeRunner = (args: string[], cwd: string) => Promise<void>

export interface EmbeddingRuntimeInstallerOptions {
  /** Kilo config directory (`~/.config/kilo`); the package goes into its node_modules. */
  dir: string
  /** Package spec; defaults to {@link EMBEDDING_RUNTIME_SPEC}. */
  spec?: string
  /** Runner override (tests); defaults to spawning npm. */
  run?: RuntimeRunner
  debug?: (message: string) => void
}

/**
 * Whether the plugin can resolve the embedding runtime from `dir`.
 *
 * Resolution starts at the plugin file rather than at this module: the published
 * bundle lives in `~/.config/kilo/plugin/llm-memory.js`, so a package installed
 * into `~/.config/kilo/node_modules` is the one the bundle would import.
 */
export function embeddingRuntimeStatus(dir: string): EmbeddingRuntimeStatus {
  const requireFromPlugin = createRequire(join(dir, 'plugin', 'llm-memory.js'))
  let present = false
  try {
    requireFromPlugin.resolve(EMBEDDING_RUNTIME_PACKAGE)
    present = true
  } catch {
    present = false
  }
  return {
    present,
    installing: false,
    error: null,
    dir: join(dir, 'node_modules'),
    command: `npm install --no-save ${EMBEDDING_RUNTIME_SPEC}`,
  }
}

/** Spawn npm with the host's conventions (npm.cmd on Windows). */
function spawnNpm(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: 'ignore',
      // npm.cmd is a shell script on Windows: run it through the shell.
      shell: process.platform === 'win32',
      env: process.env,
    })
    child.once('error', (error) => reject(new Error(`Cannot start npm: ${error.message}`)))
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`npm install exited with code ${code ?? 'unknown'}`))
    })
  })
}

/**
 * Explicit installer: one run at a time, the result reported through
 * {@link status}. A failure keeps the runtime missing and exposes the exact
 * command plus the npm message, so the panel can tell the user what to do.
 */
export class EmbeddingRuntimeInstaller {
  private readonly dir: string
  private readonly spec: string
  private readonly run: RuntimeRunner
  private readonly debug: (message: string) => void
  private presence = false
  private installing = false
  private error: string | null = null

  constructor(options: EmbeddingRuntimeInstallerOptions) {
    this.dir = options.dir
    this.spec = options.spec ?? EMBEDDING_RUNTIME_SPEC
    this.run = options.run ?? spawnNpm
    this.debug = options.debug ?? (() => {})
    this.presence = embeddingRuntimeStatus(this.dir).present
  }

  /** Current state, including a running installation. */
  status(): EmbeddingRuntimeStatus {
    return {
      present: this.presence,
      installing: this.installing,
      error: this.error,
      dir: join(this.dir, 'node_modules'),
      command: `npm install --no-save ${this.spec}`,
    }
  }

  /**
   * Install the runtime into the plugin's resolution path.
   *
   * Idempotent: an already present package resolves immediately, and a second
   * call while one install runs joins the same promise.
   */
  async install(): Promise<EmbeddingRuntimeStatus> {
    if (this.presence) return this.status()
    if (this.installing) return this.status()
    this.installing = true
    this.error = null
    try {
      this.debug(`embeddings: installing ${this.spec} into ${this.dir}`)
      await this.run(
        ['install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', '--loglevel=error', this.spec],
        this.dir,
      )
      this.presence = embeddingRuntimeStatus(this.dir).present
      if (!this.presence) {
        this.error = `npm reported success but ${EMBEDDING_RUNTIME_PACKAGE} is still not resolvable from ${this.dir}`
      }
    } catch (error) {
      this.error = `${error instanceof Error ? error.message : String(error)}; run \`${this.status().command}\` in ${this.dir} and retry`
    } finally {
      this.installing = false
    }
    this.debug(`embeddings: runtime ${this.presence ? 'ready' : `missing (${this.error ?? 'unknown'})`}`)
    return this.status()
  }
}
