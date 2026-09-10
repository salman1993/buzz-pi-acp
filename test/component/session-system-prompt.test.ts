import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PiAcpAgent } from '../../src/acp/agent.js'
import { SessionManager } from '../../src/acp/session.js'
import { SessionStore } from '../../src/acp/session-store.js'
import { PiRpcProcess } from '../../src/pi-rpc/process.js'
import { asAgentConn, FakeAgentSideConnection, FakePiRpcProcess } from '../helpers/fakes.js'

test('client prompts preserve their mode through explicit load and adapter restart', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-acp-session-prompt-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, 'map.json')
  const calls: Parameters<typeof PiRpcProcess.spawn>[0][] = []
  let counter = 0
  let disposed = 0
  t.mock.method(PiRpcProcess, 'spawn', async (params: Parameters<typeof PiRpcProcess.spawn>[0]) => {
    calls.push(params)
    const sessionId = params.sessionPath ? 'a' : ++counter === 1 ? 'a' : 'b'
    class Process extends FakePiRpcProcess {
      async getState() {
        return { sessionId, sessionFile: join(root, `${sessionId}.jsonl`), thinkingLevel: 'medium' }
      }
      dispose() {
        disposed++
      }
      async setThinkingLevel() {}
      async setSessionName() {}
    }
    return new Process() as unknown as PiRpcProcess
  })
  function createAgent() {
    const agent = new PiAcpAgent(asAgentConn(new FakeAgentSideConnection()), { piArgs: ['--skill', '/launch skills'] })
    const internals = agent as unknown as { store: SessionStore; sessions: SessionManager }
    internals.store = new SessionStore(path)
    ;(internals.sessions as unknown as { store: SessionStore }).store = new SessionStore(path)
    t.after(() => agent.dispose())
    return agent
  }
  const agent = createAgent()
  const initialized = await agent.initialize({ protocolVersion: 1, clientCapabilities: {} })
  assert.equal(initialized.agentInfo?.name, 'buzz-pi-acp')
  assert.equal(initialized.agentCapabilities?._meta, undefined)
  await assert.rejects(
    agent.newSession({ cwd: root, mcpServers: [], _meta: { systemPrompt: null } } as Parameters<
      typeof agent.newSession
    >[0]),
    { code: -32602 }
  )
  assert.equal(calls.length, 0)
  const a = await agent.newSession({
    cwd: root,
    mcpServers: [],
    _meta: { systemPrompt: { append: 'prompt A' }, sessionTitle: 'A' }
  } as Parameters<typeof agent.newSession>[0])
  assert.equal(disposed, 0)
  await agent.setSessionMode({ sessionId: a.sessionId, modeId: 'medium' })
  assert.deepEqual(
    calls.map(call => call.systemPrompt),
    [{ mode: 'append', text: 'prompt A' }]
  )
  agent.dispose()
  const restarted = createAgent()
  await restarted.loadSession({ cwd: root, sessionId: a.sessionId, mcpServers: [] })
  assert.deepEqual(calls.at(-1)?.systemPrompt, { mode: 'append', text: 'prompt A' })
  assert.ok(calls.every(call => JSON.stringify(call.piArgs) === JSON.stringify(['--skill', '/launch skills'])))
  assert.deepEqual(new SessionStore(path).get('a')?.systemPrompt, { mode: 'append', text: 'prompt A' })
  await restarted.deleteSession({ sessionId: a.sessionId })
  assert.equal(new SessionStore(path).get('a'), null)
  await new Promise(resolve => setTimeout(resolve, 10))
})
