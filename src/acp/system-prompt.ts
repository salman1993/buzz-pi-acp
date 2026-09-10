import { RequestError } from '@agentclientprotocol/sdk'

export function parseSystemPrompt(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }
  throw RequestError.invalidParams('_meta.systemPrompt must be a nonempty string')
}
