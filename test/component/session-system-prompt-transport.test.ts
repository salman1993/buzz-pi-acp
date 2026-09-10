import test from 'node:test'
import assert from 'node:assert/strict'
import { AgentSideConnection, type Agent, type AnyMessage, type Stream } from '@agentclientprotocol/sdk'
import {
  preserveNewSessionSystemPrompt,
  systemPromptFromNewSessionRequest,
  type PiNewSessionRequest
} from '../../src/acp/new-session-request.js'

test('systemPrompt survives SDK validation before newSession', async () => {
  const incoming = new TransformStream<AnyMessage, AnyMessage>()
  const outgoing = new TransformStream<AnyMessage, AnyMessage>()
  const stream: Stream = { readable: incoming.readable, writable: outgoing.writable }
  let received: PiNewSessionRequest | undefined
  const connection = new AgentSideConnection(
    () =>
      ({
        async newSession(params: PiNewSessionRequest) {
          received = params
          return { sessionId: 'session-1' }
        }
      }) as unknown as Agent,
    preserveNewSessionSystemPrompt(stream)
  )
  const writer = incoming.writable.getWriter()
  const reader = outgoing.readable.getReader()

  await writer.write({
    jsonrpc: '2.0',
    id: 1,
    method: 'session/new',
    params: {
      cwd: '/workspace',
      mcpServers: [],
      systemPrompt: 'Buzz session instructions',
      _meta: { sessionTitle: 'Transport test' }
    }
  })

  let response: AnyMessage | undefined
  while (!response || !('id' in response) || response.id !== 1) {
    const next = await reader.read()
    assert.equal(next.done, false)
    response = next.value
  }

  assert.ok('result' in response)
  assert.ok(received)
  assert.equal(received.systemPrompt, undefined)
  assert.equal(received._meta?.sessionTitle, 'Transport test')
  assert.equal(systemPromptFromNewSessionRequest(received), 'Buzz session instructions')
  assert.equal(
    systemPromptFromNewSessionRequest({
      cwd: '/workspace',
      mcpServers: [],
      _meta: { 'piAcp.transportSystemPrompt': {} }
    }),
    undefined
  )

  await writer.close()
  await connection.closed
  reader.releaseLock()
})
