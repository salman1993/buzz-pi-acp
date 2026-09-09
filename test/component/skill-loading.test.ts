import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

test(
  'real ACP loads launch skills in new sessions, restored sessions, and after restart',
  {
    skip: process.env.PI_ACP_TEST_REAL_PI !== '1' || process.platform === 'win32'
  },
  async t => {
    const root = mkdtempSync(join(tmpdir(), 'pi-acp-skill-test-'))
    const home = join(root, 'home')
    const cwd = join(root, 'workspace')
    const skillPaths = [join(root, 'extra skills'), join(root, 'other skills')]
    mkdirSync(cwd)
    mkdirSync(home)
    for (const [index, path] of skillPaths.entries()) {
      mkdirSync(path)
      writeFileSync(
        join(path, 'SKILL.md'),
        `---\nname: fixture-${index}\ndescription: Skill fixture ${index}\n---\nSynthetic skill instructions.\n`
      )
    }
    const nativeSkill = join(root, 'agent', 'skills', 'native')
    mkdirSync(nativeSkill, { recursive: true })
    writeFileSync(
      join(nativeSkill, 'SKILL.md'),
      '---\nname: native-fixture\ndescription: Native skill fixture\n---\nSynthetic native skill.\n'
    )
    t.after(() => rmSync(root, { recursive: true, force: true }))

    function start() {
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve('src/index.ts'),
          '--',
          '--offline',
          '--no-extensions',
          '--no-context-files',
          ...skillPaths.flatMap(path => ['--skill', path])
        ],
        {
          detached: true,
          env: {
            ...process.env,
            HOME: home,
            PI_CODING_AGENT_DIR: join(root, 'agent'),
            PI_ACP_PI_COMMAND: 'pi',
            ANTHROPIC_API_KEY: 'synthetic-test-key'
          },
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )
      child.stderr.resume()
      let id = 0
      const pending = new Map<
        number,
        { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
      >()
      const skillsBySession = new Map<string, string[]>()
      createInterface({ input: child.stdout }).on('line', line => {
        const message = JSON.parse(line)
        if (message.id !== undefined) {
          const request = pending.get(message.id)
          if (message.error) request?.reject(new Error(JSON.stringify(message.error)))
          else request?.resolve(message.result)
          pending.delete(message.id)
        }
        if (message.params?.update?.sessionUpdate === 'available_commands_update') {
          skillsBySession.set(
            message.params.sessionId,
            message.params.update.availableCommands.map((command: { name: string }) => command.name)
          )
        }
      })
      child.on('error', error => {
        for (const request of pending.values()) request.reject(error)
      })
      async function rpc(method: string, params: Record<string, unknown>) {
        const requestId = ++id
        return new Promise<Record<string, unknown>>((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(requestId)
            reject(new Error(`Timed out: ${method}`))
          }, 25000)
          pending.set(requestId, {
            resolve: value => {
              clearTimeout(timer)
              resolve(value)
            },
            reject: error => {
              clearTimeout(timer)
              reject(error)
            }
          })
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n')
        })
      }
      async function checkSkills(sessionId: string) {
        for (let attempt = 0; !skillsBySession.has(sessionId) && attempt < 200; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        assert.ok(skillsBySession.get(sessionId)?.includes('skill:fixture-0'))
        assert.ok(skillsBySession.get(sessionId)?.includes('skill:fixture-1'))
        assert.ok(skillsBySession.get(sessionId)?.includes('skill:native-fixture'))
      }
      async function stop() {
        if (child.exitCode !== null) return
        await new Promise<void>(resolve => {
          child.once('exit', () => resolve())
          process.kill(-child.pid!, 'SIGTERM')
        })
      }
      return { rpc, checkSkills, stop }
    }
    let client = start()
    try {
      await client.rpc('initialize', { protocolVersion: 1, clientCapabilities: {} })
      const result = await client.rpc('session/new', {
        cwd,
        mcpServers: [],
        _meta: { systemPrompt: 'Session prompt fixture' }
      })
      const sessionId = result.sessionId
      assert.equal(typeof sessionId, 'string')
      const id = sessionId as string
      await client.checkSkills(id)
      const store = JSON.parse(readFileSync(join(home, '.pi/pi-acp/session-map.json'), 'utf-8'))
      const transcript = store.sessions[id].sessionFile as string
      const timestamp = '2026-01-01T00:00:00.000Z'
      writeFileSync(
        transcript,
        [
          { type: 'session', version: 3, id, timestamp, cwd },
          {
            type: 'message',
            id: '00000001',
            parentId: null,
            timestamp,
            message: {
              role: 'user',
              content: [{ type: 'text', text: 'Synthetic fixture' }],
              timestamp: 1767225600000
            }
          }
        ]
          .map(entry => JSON.stringify(entry))
          .join('\n') + '\n'
      )
      await client.rpc('session/new', { cwd, mcpServers: [] })
      async function checkExport() {
        await client.rpc('session/prompt', { sessionId: id, prompt: [{ type: 'text', text: '/export' }] })
        const html = readFileSync(join(cwd, `pi-session-${id}.html`), 'utf-8')
        const encoded = html.match(/<script id="session-data"[^>]*>([\s\S]*?)<\/script>/)?.[1]
        assert.ok(encoded)
        const data = JSON.parse(Buffer.from(encoded.trim(), 'base64').toString('utf-8'))
        assert.match(data.systemPrompt, /Session prompt fixture/)
        assert.match(data.systemPrompt, /Native skill fixture/)
        for (const index of [0, 1]) assert.match(data.systemPrompt, new RegExp(`Skill fixture ${index}`))
      }
      await checkExport()
      await client.stop()
      client = start()
      await client.rpc('initialize', { protocolVersion: 1, clientCapabilities: {} })
      await client.rpc('session/load', { sessionId: id, cwd, mcpServers: [] })
      await client.checkSkills(id)
      await checkExport()
    } finally {
      await client.stop()
    }
  }
)
