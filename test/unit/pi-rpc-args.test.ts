import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPiArgs } from '../../src/pi-rpc/process.js'

test('buildPiArgs forwards every explicit skill path to Pi', () => {
  assert.deepEqual(
    buildPiArgs({
      cwd: '/tmp/project',
      skillPaths: ['.agents/skills/', '/absolute/path/SKILL.md'],
      sessionPath: '/tmp/session.jsonl'
    }),
    [
      '--mode',
      'rpc',
      '--no-themes',
      '--skill',
      '.agents/skills/',
      '--skill',
      '/absolute/path/SKILL.md',
      '--session',
      '/tmp/session.jsonl'
    ]
  )
})
