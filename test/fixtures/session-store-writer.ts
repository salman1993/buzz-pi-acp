import { SessionStore } from '../../src/acp/session-store.js'

const [sessionsDir, sessionId] = process.argv.slice(2)

if (!sessionsDir || !sessionId || !process.send) {
  throw new Error('Expected a metadata directory, a session ID, and an IPC channel')
}

const store = new SessionStore(sessionsDir)

process.once('message', () => {
  store.upsert({
    sessionId,
    cwd: `/tmp/${sessionId}`,
    sessionFile: `/tmp/${sessionId}.jsonl`,
    systemPrompt: { mode: 'append', text: `Buzz prompt for ${sessionId}` }
  })
  process.send?.('done', undefined, undefined, () => process.exit(0))
})

process.send('ready')
