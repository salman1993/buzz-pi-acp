import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseSystemPrompt } from '../../src/acp/system-prompt.js'
import { SessionStore } from '../../src/acp/session-store.js'
import { prepareSystemPrompt } from '../../src/pi-rpc/system-prompt.js'

test('system prompt request accepts append and replacement forms', () => {
  assert.equal(parseSystemPrompt(undefined), undefined)
  assert.deepEqual(parseSystemPrompt('  instructions\n'), { mode: 'replace', text: '  instructions\n' })
  assert.deepEqual(parseSystemPrompt({ replace: 'replacement' }), { mode: 'replace', text: 'replacement' })
  assert.deepEqual(parseSystemPrompt({ append: 'addition' }), { mode: 'append', text: 'addition' })
  for (const value of [
    null,
    '',
    '  ',
    1,
    true,
    [],
    {},
    { append: null },
    { append: '' },
    { append: 1 },
    { replace: null },
    { replace: '' },
    { replace: 1 },
    { append: 'x', replace: 'y' },
    { append: 'x', preset: 'claude_code' }
  ]) {
    assert.throws(() => parseSystemPrompt(value), { code: -32602 })
  }
})

test('prompt files preserve literal paths, multiline text, and large prompts without putting text in argv', () => {
  const text = '/etc/hosts\n"quotes" $HOME `literal`\n' + 'large prompt '.repeat(20000)
  const prepared = prepareSystemPrompt({ mode: 'replace', text })
  const path = prepared.args[1]
  try {
    assert.equal(prepared.args[0], '--system-prompt')
    assert.equal(readFileSync(path, 'utf-8'), text)
    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600)
  } finally {
    prepared.dispose()
  }
  assert.equal(existsSync(path), false)
  assert.deepEqual(prepareSystemPrompt().args, [])

  const appended = prepareSystemPrompt({ mode: 'append', text: 'additional instructions' })
  try {
    assert.equal(appended.args[0], '--append-system-prompt')
    assert.equal(readFileSync(appended.args[1], 'utf-8'), 'additional instructions')
  } finally {
    appended.dispose()
  }
})

test('session metadata uses isolated files and preserves updates', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-acp-store-test-'))
  const sessionsDir = join(root, 'sessions')
  try {
    const store = new SessionStore(sessionsDir)
    const a = { sessionId: 'a', cwd: root, sessionFile: join(root, 'a.jsonl') }
    const b = { sessionId: 'b', cwd: root, sessionFile: join(root, 'b.jsonl') }
    const systemPrompt = { mode: 'append', text: 'A' } as const
    store.upsert({ ...a, systemPrompt })
    store.upsert({ ...b, systemPrompt: { mode: 'replace', text: 'B' } })
    const reopened = new SessionStore(sessionsDir)
    reopened.upsert(a)
    assert.deepEqual(reopened.get('a')?.systemPrompt, systemPrompt)
    assert.deepEqual(reopened.get('b')?.systemPrompt, { mode: 'replace', text: 'B' })
    const metadataFiles = readdirSync(sessionsDir).map(name => join(sessionsDir, name))
    assert.equal(metadataFiles.length, 2)
    if (process.platform !== 'win32') {
      for (const metadataFile of metadataFiles) assert.equal(statSync(metadataFile).mode & 0o777, 0o600)
    }
    reopened.delete('a')
    assert.equal(reopened.get('a'), null)
    assert.ok(reopened.get('b'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
