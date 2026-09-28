import test from 'node:test'
import assert from 'node:assert/strict'
import { PiAcpAgent } from '../../src/acp/agent.js'
import { PiAcpSession } from '../../src/acp/session.js'
import type { PiRpcProcess } from '../../src/pi-rpc/process.js'
import { FakeAgentSideConnection, FakePiRpcProcess, asAgentConn } from '../helpers/fakes.js'

function setup() {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  const session = new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as unknown as PiRpcProcess,
    conn: asAgentConn(conn)
  })
  const agent = new PiAcpAgent(asAgentConn(conn))
  Object.defineProperty(agent, 'sessions', {
    value: { maybeGet: (id: string) => (id === session.sessionId ? session : null) }
  })
  return { agent, proc, session }
}

const steeringParams = {
  sessionId: 's1',
  prompt: [{ type: 'text', text: 'Change direction' }]
}

test('initialize advertises the steering extension', async () => {
  const { agent } = setup()
  const response = await agent.initialize({ protocolVersion: 1 })
  assert.deepEqual(response._meta?.steering, { supported: true })
})

test('an active turn uses Pi steer without cancelling or starting another turn', async () => {
  const { agent, proc, session } = setup()
  const running = session.prompt('Original request')
  proc.emit({ type: 'agent_start' })

  const image = { type: 'image', mimeType: 'image/png', data: 'aGk=' }
  const result = await agent.extMethod('_session/steering', {
    sessionId: 's1',
    prompt: [{ type: 'text', text: 'Change direction' }, image]
  })

  assert.deepEqual(result, { outcome: 'injected' })
  assert.deepEqual(proc.steers, [{ message: 'Change direction', attachments: [image] }])
  assert.deepEqual(proc.prompts, [{ message: 'Original request', attachments: [] }])
  assert.equal(proc.abortCount, 0)

  proc.emit({ type: 'agent_end' })
  proc.emit({ type: 'agent_settled' })
  assert.equal(await running, 'end_turn')
})

test('startup and settlement gaps request a trackable prompt instead of queueing an idle Pi steer', async () => {
  const { agent, proc, session } = setup()
  const running = session.prompt('Original request')

  assert.deepEqual(await agent.extMethod('_session/steering', steeringParams), {
    outcome: 'promptRequired',
    reason: 'noRunningTurn'
  })
  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'agent_end' })
  assert.deepEqual(await agent.extMethod('_session/steering', steeringParams), {
    outcome: 'promptRequired',
    reason: 'noRunningTurn'
  })
  assert.equal(proc.steers.length, 0)
  assert.equal(proc.prompts.length, 1)

  proc.emit({ type: 'agent_settled' })
  await running
})

test('idle client opt-in requests a normal prompt', async () => {
  const { agent, proc } = setup()
  assert.deepEqual(
    await agent.extMethod('_session/steering', {
      ...steeringParams,
      _meta: { steering: { idleBehavior: 'promptRequired' } }
    }),
    { outcome: 'promptRequired', reason: 'noRunningTurn' }
  )
  assert.equal(proc.prompts.length, 0)
})

test('idle steering starts a new turn and waits for Pi prompt acceptance', async () => {
  const { agent, proc } = setup()
  let acceptPrompt: (() => void) | undefined
  proc.prompt = async (message, attachments = []) => {
    proc.prompts.push({ message, attachments })
    await new Promise<void>(resolve => {
      acceptPrompt = resolve
    })
  }

  let responded = false
  const response = agent.extMethod('_session/steering', steeringParams).then(result => {
    responded = true
    return result
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(responded, false)
  assert.deepEqual(proc.prompts, [{ message: 'Change direction', attachments: [] }])
  acceptPrompt?.()
  assert.deepEqual(await response, { outcome: 'startedNewTurn' })
})

test('Pi rejection does not acknowledge delivery', async () => {
  const { agent, proc, session } = setup()
  proc.steer = async () => {
    throw new Error('steer rejected')
  }
  const running = session.prompt('Original request')
  proc.emit({ type: 'agent_start' })

  await assert.rejects(agent.extMethod('_session/steering', steeringParams), /steer rejected/)
  proc.emit({ type: 'agent_end' })
  proc.emit({ type: 'agent_settled' })
  await running
})

test('idle prompt rejection does not acknowledge delivery', async () => {
  const { agent, proc } = setup()
  proc.prompt = async () => {
    throw new Error('prompt rejected')
  }
  await assert.rejects(agent.extMethod('_session/steering', steeringParams), /prompt rejected/)
})

test('invalid extension calls fail without contacting Pi', async () => {
  const { agent, proc } = setup()
  await assert.rejects(agent.extMethod('_other/method', steeringParams))
  await assert.rejects(agent.extMethod('_session/steering', { ...steeringParams, prompt: [] }))
  await assert.rejects(agent.extMethod('_session/steering', { ...steeringParams, sessionId: '' }))
  await assert.rejects(agent.extMethod('_session/steering', { ...steeringParams, sessionId: 'missing' }))
  assert.equal(proc.steers.length, 0)
  assert.equal(proc.prompts.length, 0)
})
