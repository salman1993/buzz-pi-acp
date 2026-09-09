import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function prepareSystemPrompt(prompt?: string): { args: string[]; dispose: () => void } {
  if (!prompt) return { args: [], dispose: () => {} }

  const directory = mkdtempSync(join(tmpdir(), 'pi-acp-prompt-'))
  const dispose = () => {
    rmSync(directory, { recursive: true, force: true })
  }
  try {
    const path = join(directory, 'prompt.md')
    writeFileSync(path, prompt, { encoding: 'utf-8', mode: 0o600, flag: 'wx' })
    return {
      args: ['--system-prompt', path],
      dispose
    }
  } catch (error) {
    dispose()
    throw error
  }
}
