/**
 * Embedding runtime of the Kilo plugin.
 *
 * The plugin ships as one file and cannot bundle `@huggingface/transformers`
 * (native ONNX binaries, ~100 MB), so the package has to be resolvable from the
 * plugin directory. This module detects it and installs it into
 * `~/.config/kilo` through npm — only when the user explicitly asks for the
 * model, never behind their back.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  EmbeddingRuntimeInstaller,
  embeddingRuntimeStatus,
} from '@llm-memory/adapter/kilo/runtime-install'

const dirs: string[] = []
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kilo-runtime-'))
  dirs.push(dir)
  return dir
}

function installFakePackage(dir: string, version = '4.3.1'): void {
  const pkg = join(dir, 'node_modules', '@huggingface', 'transformers')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@huggingface/transformers', version, main: 'index.js' }))
  writeFileSync(join(pkg, 'index.js'), 'module.exports = {}')

}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('embedding runtime of the Kilo plugin', () => {
  it('reports a missing runtime with the directory it would go to', () => {
    const dir = temp()
    const status = embeddingRuntimeStatus(dir)
    expect(status.present).toBe(false)
    expect(status.installing).toBe(false)
    expect(status.error).toBe(null)
    expect(status.dir).toBe(join(dir, 'node_modules'))
    expect(status.command).toContain('@huggingface/transformers')
  })

  it('detects an installed runtime', () => {
    const dir = temp()
    installFakePackage(dir)
    expect(embeddingRuntimeStatus(dir).present).toBe(true)
  })

  it('sees a runtime installed after the installer was created', () => {
    const dir = temp()
    const installer = new EmbeddingRuntimeInstaller({ dir })
    expect(installer.status().present).toBe(false)
    installFakePackage(dir)
    expect(installer.status().present).toBe(true)
  })

  it('skips npm when the package appeared after construction', async () => {
    const dir = temp()
    let calls = 0
    const installer = new EmbeddingRuntimeInstaller({ dir, run: async () => { calls += 1 } })
    installFakePackage(dir)
    const done = await installer.install()
    expect(done.present).toBe(true)
    expect(calls).toBe(0)
  })

  it('installs through the injected runner and reports the state', async () => {
    const dir = temp()
    const calls: Array<{ args: string[]; cwd: string }> = []
    const installer = new EmbeddingRuntimeInstaller({
      dir,
      run: async (args, cwd) => {
        calls.push({ args, cwd })
        installFakePackage(dir)
      },
    })

    const running = installer.install()
    expect(installer.status().installing).toBe(true)
    const done = await running
    expect(calls).toHaveLength(1)
    expect(calls[0]!.cwd).toBe(dir)
    expect(calls[0]!.args.join(' ')).toContain('@huggingface/transformers')
    expect(done.present).toBe(true)
    expect(done.installing).toBe(false)
    expect(done.error).toBe(null)
  })

  it('reports the failure and stays uninstalled when npm fails', async () => {
    const dir = temp()
    const installer = new EmbeddingRuntimeInstaller({
      dir,
      run: async () => {
        throw new Error('npm not found')
      },
    })
    const done = await installer.install()
    expect(done.present).toBe(false)
    expect(done.installing).toBe(false)
    expect(done.error).toMatch(/npm not found/)
    expect(done.command).toContain('@huggingface/transformers')
  })

  it('does not install twice', async () => {
    const dir = temp()
    installFakePackage(dir)
    let calls = 0
    const installer = new EmbeddingRuntimeInstaller({
      dir,
      run: async () => {
        calls += 1
      },
    })
    const done = await installer.install()
    expect(calls).toBe(0)
    expect(done.present).toBe(true)
  })
})
