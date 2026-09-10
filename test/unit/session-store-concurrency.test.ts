import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SessionStore } from '../../src/acp/session-store.js'

test('separate adapter processes do not overwrite other sessions', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-acp-store-concurrency-'))
  const sessionsDir = join(root, 'sessions')
  const writerPath = fileURLToPath(new URL('../fixtures/session-store-writer.ts', import.meta.url))
  const sessionIds = Array.from({ length: 10 }, (_, index) => `session-${index}`)
  const children = sessionIds.map(sessionId =>
    fork(writerPath, [sessionsDir, sessionId], {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc']
    })
  )

  t.after(() => {
    for (const child of children) child.kill()
    rmSync(root, { recursive: true, force: true })
  })

  await Promise.all(
    children.map(
      child =>
        new Promise<void>((resolve, reject) => {
          child.once('message', message =>
            message === 'ready' ? resolve() : reject(new Error('Writer was not ready'))
          )
          child.once('error', reject)
          child.once('exit', code => reject(new Error(`Writer exited before it was ready: ${code}`)))
        })
    )
  )

  await Promise.all(
    children.map(
      child =>
        new Promise<void>((resolve, reject) => {
          child.once('message', message =>
            message === 'done' ? resolve() : reject(new Error('Writer did not finish'))
          )
          child.once('error', reject)
          child.send('write')
        })
    )
  )

  const store = new SessionStore(sessionsDir)
  for (const sessionId of sessionIds) {
    assert.equal(store.get(sessionId)?.systemPrompt?.text, `Buzz prompt for ${sessionId}`)
  }
  assert.equal(readdirSync(sessionsDir).length, sessionIds.length)
})
