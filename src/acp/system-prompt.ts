import { RequestError } from '@agentclientprotocol/sdk'
import type { SystemPrompt } from '../pi-rpc/system-prompt.js'

export function parseSystemPrompt(value: unknown): SystemPrompt | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && value.trim().length > 0) {
    return { mode: 'replace', text: value }
  }
  throw RequestError.invalidParams('systemPrompt must be a nonempty string')
}
