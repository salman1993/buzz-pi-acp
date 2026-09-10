import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PiAcpAgent } from '../../src/acp/agent.js'
import { SessionManager } from '../../src/acp/session.js'
import { SessionStore } from '../../src/acp/session-store.js'
import { sanitizeSessionTitle } from '../../src/acp/session-title.js'
import { PiRpcProcess } from '../../src/pi-rpc/process.js'
import { asAgentConn, FakeAgentSideConnection, FakePiRpcProcess } from '../helpers/fakes.js'

test('session titles follow the whitespace and 256-character contract', () => {
  assert.equal(sanitizeSessionTitle('  Fix\nthe   login\tbug  '), 'Fix the login bug')
  assert.equal(sanitizeSessionTitle('x'.repeat(256)), 'x'.repeat(256))
  assert.equal(sanitizeSessionTitle('x'.repeat(300)), 'x'.repeat(255) + '…')
  for (const value of [undefined, null, 42, {}, [], true, '', ' \n\t ']) {
    assert.equal(sanitizeSessionTitle(value), undefined)
  }
})

test('new session titles are applied, announced, restored before flush, and do not override persisted names', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-acp-title-test-'))
  const store = new SessionStore(join(root, 'map.json'))
  const conn = new FakeAgentSideConnection()
  const agent = new PiAcpAgent(asAgentConn(conn))
  const internals = agent as unknown as { store: SessionStore; sessions: SessionManager }
  internals.store = store
  ;(internals.sessions as unknown as { store: SessionStore }).store = store
  t.after(() => {
    agent.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  let counter = 0
  let failNaming = false
  let disposed = 0
  const names: string[] = []
  t.mock.method(PiRpcProcess, 'spawn', async (params: Parameters<typeof PiRpcProcess.spawn>[0]) => {
    const id = params.sessionPath ? '1' : String(++counter)
    class Process extends FakePiRpcProcess {
      async getState() {
        return { sessionId: id, sessionFile: join(root, `${id}.jsonl`), thinkingLevel: 'medium' }
      }
      async setSessionName(name: string) {
        if (failNaming) throw new Error('naming failed')
        names.push(name)
      }
      async setThinkingLevel() {}
      dispose() {
        disposed++
      }
    }
    return new Process() as unknown as PiRpcProcess
  })
  const a = await agent.newSession({
    cwd: root,
    mcpServers: [],
    _meta: {
      systemPrompt: 'instructions',
      sessionTitle: ' Fix\nthe  login bug '
    }
  } as Parameters<typeof agent.newSession>[0])
  assert.deepEqual(names, ['Fix the login bug'])
  assert.equal(store.get(a.sessionId)?.sessionTitle, 'Fix the login bug')
  assert.deepEqual(store.get(a.sessionId)?.systemPrompt, { mode: 'replace', text: 'instructions' })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(
    conn.updates.some(
      ({ update }) => update.sessionUpdate === 'session_info_update' && update.title === 'Fix the login bug'
    )
  )
  for (const value of [undefined, null, 42, {}, '', '  ']) {
    await agent.newSession({ cwd: root, mcpServers: [], _meta: { sessionTitle: value } })
  }
  assert.equal(names.length, 1)
  await agent.setSessionMode({ sessionId: a.sessionId, modeId: 'medium' })
  assert.deepEqual(names, ['Fix the login bug', 'Fix the login bug'])
  writeFileSync(join(root, '1.jsonl'), JSON.stringify({ type: 'session_info', name: 'Later name' }) + '\n')
  await agent.loadSession({
    cwd: root,
    mcpServers: [],
    sessionId: a.sessionId,
    _meta: { sessionTitle: 'Ignored on load' }
  })
  assert.equal(names.length, 2)
  failNaming = true
  const before = disposed
  await assert.rejects(agent.newSession({ cwd: root, mcpServers: [], _meta: { sessionTitle: 'Fail' } }), {
    code: -32603
  })
  assert.equal(store.get(String(counter)), null)
  assert.equal(disposed, before + 1)
  await new Promise(resolve => setTimeout(resolve, 10))
})
