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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => (resolve = r))
  return { promise, resolve }
}

function deliveries(proc: FakePiRpcProcess, text: string): number {
  return proc.consumed.filter(m => m === text).length + proc.prompts.filter(p => p.message === text).length
}

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
  assert.equal(proc.abortCount, 0)

  proc.consumeSteers()
  proc.emit({ type: 'agent_end' })
  proc.emit({ type: 'agent_settled' })
  assert.equal(await running, 'end_turn')
  assert.deepEqual(proc.prompts, [{ message: 'Original request', attachments: [] }])
  assert.equal(deliveries(proc, 'Change direction'), 1)
})

test('a steer Pi accepts after its final drain replays once before the turn completes', async () => {
  const { agent, proc, session } = setup()
  const running = session.prompt('Original request')
  proc.emit({ type: 'agent_start' })

  const image = { type: 'image', mimeType: 'image/png', data: 'aGk=' }
  const steerSent = deferred<void>()
  const piSteer = deferred<void>()
  const queueSteer = proc.steer.bind(proc)
  proc.steer = async (message, attachments) => {
    steerSent.resolve()
    await piSteer.promise
    return queueSteer(message, attachments)
  }

  const order: string[] = []
  const ack = agent
    .extMethod('_session/steering', { sessionId: 's1', prompt: [{ type: 'text', text: 'Change direction' }, image] })
    .then(result => {
      order.push('ack')
      return result
    })
  void running.then(() => order.push('prompt'))

  await steerSent.promise
  proc.emit({ type: 'agent_end' })
  proc.emit({ type: 'agent_settled' })
  piSteer.resolve()

  assert.deepEqual(await ack, { outcome: 'injected' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(proc.calls, ['clear_queue'])
  assert.deepEqual(proc.steeringQueue, [])
  assert.deepEqual(proc.prompts[1], { message: 'Change direction', attachments: [image] })

  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'agent_end' })
  proc.emit({ type: 'agent_settled' })
  assert.equal(await running, 'end_turn')
  assert.deepEqual(order, ['ack', 'prompt'])
  assert.equal(deliveries(proc, 'Change direction'), 1)
})

test('a queued steer still pending at settlement replays once', async () => {
  const { agent, proc, session } = setup()
  const running = session.prompt('Original request')
  proc.emit({ type: 'agent_start' })

  await agent.extMethod('_session/steering', { sessionId: 's1', prompt: [{ type: 'text', text: 'First' }] })
  proc.consumeSteers()
  await agent.extMethod('_session/steering', { sessionId: 's1', prompt: [{ type: 'text', text: 'Second' }] })
  proc.emit({ type: 'agent_settled' })
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(
    proc.prompts.map(p => p.message),
    ['Original request', 'Second']
  )
  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'agent_settled' })
  assert.equal(await running, 'end_turn')
  assert.equal(deliveries(proc, 'First'), 1)
  assert.equal(deliveries(proc, 'Second'), 1)
})

test('a steer an input extension handles is never replayed', async () => {
  const { agent, proc, session } = setup()
  proc.handledByExtension.add('B')
  const running = session.prompt('Original request')
  proc.emit({ type: 'agent_start' })

  await agent.extMethod('_session/steering', { sessionId: 's1', prompt: [{ type: 'text', text: 'A' }] })
  await agent.extMethod('_session/steering', { sessionId: 's1', prompt: [{ type: 'text', text: 'B' }] })
  proc.emit({ type: 'agent_settled' })
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(
    proc.prompts.map(p => p.message),
    ['Original request', 'A']
  )
  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'agent_settled' })
  assert.equal(await running, 'end_turn')
  assert.equal(deliveries(proc, 'A'), 1)
  assert.equal(deliveries(proc, 'B'), 0)
})

test('steers outside the running Pi loop are rejected without cancelling the turn', async () => {
  const { agent, proc, session } = setup()
  const running = session.prompt('Original request')

  await assert.rejects(agent.extMethod('_session/steering', steeringParams), /turnNotSteerable|starting, settling/)

  proc.emit({ type: 'agent_start' })
  await agent.extMethod('_session/steering', steeringParams)
  const clearQueue = deferred<{ steering: string[]; followUp: string[] }>()
  proc.clearQueue = () => clearQueue.promise
  proc.emit({ type: 'agent_settled' })

  await assert.rejects(agent.extMethod('_session/steering', steeringParams), /starting, settling/)
  assert.equal(proc.steers.length, 1)
  assert.equal(proc.abortCount, 0)

  clearQueue.resolve({ steering: [], followUp: [] })
  assert.equal(await running, 'end_turn')
})

test('cancel drops acknowledged steers before aborting', async () => {
  const { agent, proc, session } = setup()
  const running = session.prompt('Original request')
  proc.emit({ type: 'agent_start' })
  await agent.extMethod('_session/steering', steeringParams)

  await session.cancel()
  assert.deepEqual(proc.calls, ['clear_queue', 'abort'])

  proc.emit({ type: 'agent_end' })
  proc.emit({ type: 'agent_settled' })
  assert.equal(await running, 'cancelled')
  assert.deepEqual(proc.prompts, [{ message: 'Original request', attachments: [] }])
  assert.equal(deliveries(proc, 'Change direction'), 0)
})

test('idle steering requests a normal prompt, including after settlement', async () => {
  const { agent, proc, session } = setup()
  const promptRequired = { outcome: 'promptRequired', reason: 'noRunningTurn' }

  assert.deepEqual(await agent.extMethod('_session/steering', steeringParams), promptRequired)
  assert.equal(proc.prompts.length, 0)

  const running = session.prompt('Original request')
  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'agent_end' })
  proc.emit({ type: 'agent_settled' })
  await running

  assert.deepEqual(await agent.extMethod('_session/steering', steeringParams), promptRequired)
  assert.deepEqual(proc.prompts, [{ message: 'Original request', attachments: [] }])
  assert.equal(proc.steers.length, 0)
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
  assert.equal(await running, 'end_turn')
  assert.deepEqual(proc.calls, [])
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
