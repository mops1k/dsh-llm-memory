/**
 * End-to-end check of the shipped binary: `scripts/build-mcp.mjs` produces
 * `lib/mcp.js`, and the real process speaks MCP over stdio — the way a client
 * launches it (`llm-memory-mcp --client-id ...`).
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const root = process.cwd()
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build-mcp.mjs'], { cwd: root, stdio: 'pipe' })
}, 120_000)

function sandbox(): { home: string; repo: string; store: string } {
  const dir = mkdtempSync(join(tmpdir(), 'llm-mcp-cli-'))
  dirs.push(dir)
  const home = join(dir, 'home')
  const repo = join(dir, 'repo')
  const store = join(dir, 'store')
  mkdirSync(home, { recursive: true })
  mkdirSync(repo, { recursive: true })
  return { home, repo, store }
}

interface StdioProcess {
  child: ReturnType<typeof spawn>
  lines: string[]
  waitFor(count: number): Promise<string[]>
  stderr(): string
}

function startCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): StdioProcess {
  const child = spawn(process.execPath, [join(root, 'lib/mcp.js'), ...args], {
    cwd,
    env: { ...process.env, ...env },
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
  return {
    child,
    lines,
    stderr: () => errorText,
    async waitFor(count) {
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        if (lines.length >= count) return lines
        if (child.exitCode !== null) throw new Error(`process exited ${child.exitCode}: ${errorText}`)
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      throw new Error(`timed out waiting for ${count} lines; stderr: ${errorText}`)
    },
  }
}

function exited(child: ReturnType<typeof spawn>): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise(resolve => child.once('exit', code => resolve(code)))
}

describe('llm-memory-mcp binary', () => {
  it('answers initialize and tools/list over stdio', async () => {
    const { repo, store } = sandbox()
    const cli = startCli(['--client-id', 'e2e', '--storage-root', store, '--no-ui'], repo)
    try {
      cli.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } })}\n`)
      cli.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`)
      cli.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'llm_memory_save', arguments: { text: 'binary smoke', title: 'smoke' } } })}\n`)
      const lines = await cli.waitFor(3)
      const initialize = JSON.parse(lines[0]!)
      expect(initialize.result.serverInfo.name).toBe('llm-memory-mcp')
      expect(initialize.result.serverInfo.version).not.toBe('0.0.0-dev')
      const tools = JSON.parse(lines[1]!)
      expect(tools.result.tools.map((tool: { name: string }) => tool.name)).toContain('llm_memory_save')
      const saved = JSON.parse(lines[2]!)
      expect(saved.result.content[0].text).toContain('Сохранено')
      expect(existsSync(join(store, '_db', 'memory.db'))).toBe(true)
      cli.child.stdin?.end()
      expect(await exited(cli.child)).toBe(0)
    } finally {
      cli.child.kill()
    }
  })

  it('prints its version and refuses to run without a client id', async () => {
    const version = spawn(process.execPath, [join(root, 'lib/mcp.js'), '--version'], { cwd: root })
    let out = ''
    version.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    expect(await exited(version)).toBe(0)
    expect(out).toContain('llm-memory-mcp 1.4.0')

    const { repo } = sandbox()
    const missing = startCli(['--no-ui'], repo, { LLM_MEMORY_MCP_CLIENT_ID: '' })
    expect(await exited(missing.child)).toBe(1)
    expect(missing.stderr()).toMatch(/client id is required/)
  })
})
