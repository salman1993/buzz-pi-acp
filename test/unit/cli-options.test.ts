import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePiAcpCliOptions } from '../../src/cli-options.js'

test('parsePiAcpCliOptions collects repeatable skill paths', () => {
  assert.deepEqual(
    parsePiAcpCliOptions(['--unknown', '--skill', '.agents/skills/', '--skill=/absolute/path/SKILL.md']),
    {
      skillPaths: ['.agents/skills/', '/absolute/path/SKILL.md']
    }
  )
})

test('parsePiAcpCliOptions rejects a missing skill path', () => {
  assert.throws(() => parsePiAcpCliOptions(['--skill']), /requires a file or directory path/)
  assert.throws(() => parsePiAcpCliOptions(['--skill=']), /requires a file or directory path/)
})
