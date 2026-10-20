/**
 * Platform hardening (этап 11): Cyrillic and spaces in paths, CRLF edits picked
 * up by the heal pass, and a Windows-native smoke of the MCP bundle through
 * `node.exe` when this machine runs WSL with a usable C: drive.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { MemoryEngine } from '@llm-memory/core/application/engine'
import { mergeConfig } from '@llm-memory/core/domain/config'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

describe('paths with Cyrillic and spaces', () => {
  it('stores and recalls from a directory named in Russian', async () => {
    const base = temp('llm-platform-')
    const root = join(base, 'Память проекта', 'с пробелом')
    mkdirSync(root, { recursive: true })
    const engine = new MemoryEngine({ storageRoot: root, project: 'демо', config: mergeConfig({}) })
    try {
      const saved = engine.save({ text: 'Запись с кириллицей и пробелами', title: 'Проверка пути' })
      const recalled = await engine.recall('кириллицей', { touch: false })
      expect(recalled.items.map(item => item.id)).toContain(saved.id)
      const pages = readdirSync(root, { recursive: true }).filter(file => String(file).endsWith('.md'))
      expect(pages.length).toBeGreaterThan(0)
    } finally {
      engine.close()
    }
  })

  it('reads a page rewritten with CRLF after a heal pass', async () => {
    const root = temp('llm-platform-crlf-')
    const engine = new MemoryEngine({ storageRoot: root, project: 'demo', config: mergeConfig({}) })
    try {
      const saved = engine.save({ text: 'crlf guard body', title: 'crlf guard' })
      const pages = readdirSync(root, { recursive: true })
        .map(file => join(root, String(file)))
        .filter(file => file.endsWith('.md'))
      expect(pages.length).toBeGreaterThan(0)
      const page = pages.find(file => readFileSync(file, 'utf8').includes(saved.id)) ?? pages[0]!
      const text = readFileSync(page, 'utf8').replace(/\r?\n/g, '\r\n')
      writeFileSync(page, text, 'utf8')
      engine.heal()
      const recalled = await engine.recall('crlf guard', { touch: false })
      expect(recalled.items.map(item => item.title)).toContain('crlf guard')
    } finally {
      engine.close()
    }
  })
})

const WINDOWS_NODE = '/mnt/c/Program Files/nodejs/node.exe'
const windowsAvailable = existsSync(WINDOWS_NODE) && existsSync('/mnt/c/Users/Public')

describe.skipIf(!windowsAvailable)('Windows-native smoke (node.exe)', () => {
  it('runs the MCP bundle under Windows node and answers over stdio', async () => {
    const winDirName = `llm-mcp-smoke-${Date.now()}`
    const winDirWsl = join('/mnt/c/Users/Public', winDirName)
    mkdirSync(winDirWsl, { recursive: true })
    try {
      execFileSync('cp', [join(process.cwd(), 'lib', 'mcp.js'), join(winDirWsl, 'mcp.js')])
      const scriptWin = `C:\\Users\\Public\\${winDirName}\\mcp.js`
      const storeWin = `C:\\Users\\Public\\${winDirName}\\store`
      const child = spawn(WINDOWS_NODE, [scriptWin, '--client-id', 'win-smoke', '--storage-root', storeWin, '--no-ui'], {
        cwd: winDirWsl,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const lines: string[] = []
      let buffer = ''
      let errorText = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        const parts = buffer.split('\n')
        buffer = parts.pop() ?? ''
        lines.push(...parts.filter(line => line.trim().length > 0))
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        errorText += chunk.toString('utf8')
      })
      try {
        child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })}\n`)
        child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'llm_memory_save', arguments: { text: 'windows smoke', title: 'win' } } })}\n`)
        child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'llm_memory_recall', arguments: { query: 'windows' } } })}\n`)
        const deadline = Date.now() + 30_000
        while (lines.length < 3 && Date.now() < deadline && child.exitCode === null) {
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        expect(lines.length).toBe(3)
        expect(JSON.parse(lines[0]!).result.serverInfo.name).toBe('llm-memory-mcp')
        expect(JSON.parse(lines[1]!).result.content[0].text).toContain('Сохранено')
        expect(JSON.stringify(JSON.parse(lines[2]!).result)).toContain('win')
        expect(existsSync(join(winDirWsl, 'store', '_db', 'memory.db'))).toBe(true)
      } finally {
        child.kill('SIGKILL')
        expect(errorText).not.toMatch(/Error: Cannot find module/)
      }
    } finally {
      rmSync(winDirWsl, { recursive: true, force: true })
    }
  }, 60_000)
})
