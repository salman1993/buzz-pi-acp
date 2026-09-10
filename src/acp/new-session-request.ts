import type { AnyMessage, NewSessionRequest, Stream } from '@agentclientprotocol/sdk'

const TRANSPORT_SYSTEM_PROMPT_KEY = 'piAcp.transportSystemPrompt'
const transportedSystemPrompts = new WeakMap<object, unknown>()

export type PiNewSessionRequest = NewSessionRequest & {
  systemPrompt?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function preserveNewSessionSystemPrompt(stream: Stream): Stream {
  const readable = stream.readable.pipeThrough(
    new TransformStream<AnyMessage, AnyMessage>({
      transform(message, controller) {
        if (
          !('method' in message) ||
          message.method !== 'session/new' ||
          !isRecord(message.params) ||
          !hasOwn(message.params, 'systemPrompt')
        ) {
          controller.enqueue(message)
          return
        }

        const meta = message.params._meta
        if (meta !== undefined && meta !== null && !isRecord(meta)) {
          controller.enqueue(message)
          return
        }

        // SDK 0.26 strips provisional top-level fields before calling Agent.newSession.
        const token = {}
        transportedSystemPrompts.set(token, message.params.systemPrompt)
        controller.enqueue({
          ...message,
          params: {
            ...message.params,
            _meta: {
              ...(meta ?? {}),
              [TRANSPORT_SYSTEM_PROMPT_KEY]: token
            }
          }
        })
      }
    })
  )

  return { readable, writable: stream.writable }
}

export function systemPromptFromNewSessionRequest(params: PiNewSessionRequest): unknown {
  if (hasOwn(params, 'systemPrompt')) return params.systemPrompt
  if (!isRecord(params._meta)) return undefined
  const token = params._meta[TRANSPORT_SYSTEM_PROMPT_KEY]
  return isRecord(token) ? transportedSystemPrompts.get(token) : undefined
}
