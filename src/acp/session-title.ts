export function sanitizeSessionTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const title = value.replace(/\s+/g, ' ').trim()
  if (!title) return undefined
  return title.length > 256 ? title.slice(0, 255) + '…' : title
}
