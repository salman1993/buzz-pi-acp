export type PiAcpCliOptions = {
  skillPaths: string[]
}

/** Parse adapter-specific options while preserving the historical behavior of ignoring unknown arguments. */
export function parsePiAcpCliOptions(argv: string[]): PiAcpCliOptions {
  const skillPaths: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--skill') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('--skill requires a file or directory path')
      }
      skillPaths.push(value)
      index += 1
      continue
    }

    if (arg.startsWith('--skill=')) {
      const value = arg.slice('--skill='.length)
      if (!value) throw new Error('--skill requires a file or directory path')
      skillPaths.push(value)
    }
  }

  return { skillPaths }
}
