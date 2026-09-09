import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseSystemPrompt } from '../../src/acp/system-prompt.js'
import { SessionStore } from '../../src/acp/session-store.js'
import { prepareSystemPrompt } from '../../src/pi-rpc/system-prompt.js'

test('system prompt request accepts only a nonempty replacement string', () => {
  assert.equal(parseSystemPrompt(undefined), undefined)
  assert.equal(parseSystemPrompt('  instructions\n'), '  instructions\n')
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
    { append: 'extra' },
    { append: 1 },
    { append: 'x', preset: 'claude_code' }
  ]) {
    assert.throws(() => parseSystemPrompt(value), { code: -32602 })
  }
})

test('prompt files preserve literal paths, multiline text, and large prompts without putting text in argv', () => {
  const text = '/etc/hosts\n"quotes" $HOME `literal`\n' + 'large prompt '.repeat(20000)
  const prepared = prepareSystemPrompt(text)
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
})

test('session prompt snapshots survive store recreation and metadata updates, and are deleted with the session', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-acp-store-test-'))
  const path = join(root, 'map.json')
  try {
    const store = new SessionStore(path)
    const a = { sessionId: 'a', cwd: root, sessionFile: join(root, 'a.jsonl') }
    const b = { sessionId: 'b', cwd: root, sessionFile: join(root, 'b.jsonl') }
    const systemPrompt = 'A'
    store.upsert({ ...a, systemPrompt })
    store.upsert({ ...b, systemPrompt: 'B' })
    const reopened = new SessionStore(path)
    reopened.upsert(a)
    assert.deepEqual(reopened.get('a')?.systemPrompt, systemPrompt)
    assert.equal(reopened.get('b')?.systemPrompt, 'B')
    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600)
    reopened.delete('a')
    assert.equal(reopened.get('a'), null)
    assert.ok(reopened.get('b'))
    writeFileSync(path, JSON.stringify({ version: 1, sessions: { old: { ...a, sessionId: 'old', updatedAt: '' } } }))
    assert.equal(reopened.get('old')?.systemPrompt, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
