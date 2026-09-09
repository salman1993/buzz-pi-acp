import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLaunchArgs } from '../../src/launch-args.js'

test('launch arguments preserve repeated skill paths and extension options', () => {
  const piArgs = [
    '--skill',
    '/workspace with spaces/.agents/skills',
    '--skill',
    '/other/skills',
    '--custom-option',
    'value'
  ]
  assert.deepEqual(parseLaunchArgs(['--', ...piArgs]), { terminalLogin: false, piArgs })
  assert.deepEqual(parseLaunchArgs([]), { terminalLogin: false, piArgs: [] })
  assert.deepEqual(parseLaunchArgs(['--']), { terminalLogin: false, piArgs: [] })
})

test('terminal login is recognized only as an adapter option', () => {
  assert.deepEqual(parseLaunchArgs(['--terminal-login', '--', '--skill', '/skills']), {
    terminalLogin: true,
    piArgs: ['--skill', '/skills']
  })
  assert.deepEqual(parseLaunchArgs(['--terminal-login']), { terminalLogin: true, piArgs: [] })
  assert.throws(() => parseLaunchArgs(['--', '--terminal-login']), /cannot be forwarded/)
  assert.throws(() => parseLaunchArgs(['--skill', '/skills']), /after --/)
})

test('forwarded arguments cannot replace ACP session or prompt configuration or leave RPC mode', () => {
  for (const flag of [
    '--mode',
    '--session',
    '--session-dir',
    '--session-id',
    '--fork',
    '--export',
    '--no-session',
    '--resume',
    '-r',
    '--continue',
    '-c',
    '--print',
    '-p',
    '--help',
    '-h',
    '--version',
    '-v',
    '--list-models',
    '--system-prompt',
    '--append-system-prompt'
  ]) {
    assert.throws(() => parseLaunchArgs(['--', flag]), /cannot be forwarded/)
    assert.throws(() => parseLaunchArgs(['--', `${flag}=value`]), /cannot be forwarded/)
  }
  assert.throws(() => parseLaunchArgs(['--', '--']), /cannot be forwarded/)
})
