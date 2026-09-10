export type LaunchArgs = { terminalLogin: boolean; piArgs: string[] }

const RESERVED_FLAGS = new Set([
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
  '--append-system-prompt',
  '--terminal-login'
])

export function parseLaunchArgs(argv: string[]): LaunchArgs {
  const separator = argv.indexOf('--')
  const adapterArgs = separator === -1 ? argv : argv.slice(0, separator)
  for (const arg of adapterArgs) {
    if (arg !== '--terminal-login') throw new Error(`Unknown buzz-pi-acp argument: ${arg}. Pass Pi options after --.`)
  }
  const piArgs = separator === -1 ? [] : argv.slice(separator + 1)
  for (const arg of piArgs) {
    if (RESERVED_FLAGS.has(arg.split('=')[0]) || arg === '--') {
      throw new Error(`Pi option ${arg} is managed by buzz-pi-acp and cannot be forwarded.`)
    }
  }
  return { terminalLogin: adapterArgs.includes('--terminal-login'), piArgs }
}
