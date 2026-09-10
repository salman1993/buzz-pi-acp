import { RequestError } from '@agentclientprotocol/sdk'

export type SystemPrompt = { mode: 'append' | 'replace'; text: string }

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function parseSystemPrompt(value: unknown): SystemPrompt | undefined {
  if (value === undefined) return undefined
  if (isNonemptyString(value)) {
    return { mode: 'replace', text: value }
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const entries = Object.entries(value)
    if (entries.length === 1) {
      const [mode, text] = entries[0]
      if ((mode === 'append' || mode === 'replace') && isNonemptyString(text)) {
        return { mode, text }
      }
    }
  }

  throw RequestError.invalidParams(
    '_meta.systemPrompt must be a nonempty string or an object containing exactly one nonempty append or replace string'
  )
}
