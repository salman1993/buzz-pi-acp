import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { getPiAcpSessionsDir } from './paths.js'
import type { SystemPrompt } from './system-prompt.js'

export type StoredSession = {
  sessionId: string
  cwd: string
  sessionFile: string
  updatedAt: string
  systemPrompt?: SystemPrompt
  sessionTitle?: string
}

type SessionMetadataFile = {
  version: 1
  session: StoredSession
}

function normalizeSystemPrompt(value: unknown): SystemPrompt | undefined {
  if (typeof value === 'string' && value.trim()) {
    return { mode: 'replace', text: value }
  }
  if (typeof value !== 'object' || value === null) return undefined
  const prompt = value as { mode?: unknown; text?: unknown }
  if (
    (prompt.mode === 'append' || prompt.mode === 'replace') &&
    typeof prompt.text === 'string' &&
    prompt.text.trim()
  ) {
    return { mode: prompt.mode, text: prompt.text }
  }
  return undefined
}

function ensureParentDir(path: string) {
  mkdirSync(dirname(path), { recursive: true })
}

function saveFileAtomically(path: string, data: SessionMetadataFile): void {
  ensureParentDir(path)
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, JSON.stringify(data, null, 2) + '\n', {
      encoding: 'utf-8',
      mode: 0o600,
      flag: 'wx'
    })
    renameSync(temporaryPath, path)
    chmodSync(path, 0o600)
  } finally {
    try {
      unlinkSync(temporaryPath)
    } catch {
      // The rename normally removes the temporary path.
    }
  }
}

function normalizeStoredSession(value: unknown, sessionId: string): StoredSession | null {
  if (typeof value !== 'object' || value === null) return null
  const stored = value as Partial<StoredSession>
  if (
    stored.sessionId !== sessionId ||
    typeof stored.cwd !== 'string' ||
    typeof stored.sessionFile !== 'string' ||
    typeof stored.updatedAt !== 'string'
  ) {
    return null
  }
  const systemPrompt = normalizeSystemPrompt(stored.systemPrompt)
  const sessionTitle = typeof stored.sessionTitle === 'string' && stored.sessionTitle ? stored.sessionTitle : undefined
  return {
    sessionId,
    cwd: stored.cwd,
    sessionFile: stored.sessionFile,
    updatedAt: stored.updatedAt,
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(sessionTitle ? { sessionTitle } : {})
  }
}

function loadMetadataFile(path: string, sessionId: string): StoredSession | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || (parsed as { version?: unknown }).version !== 1) {
      return null
    }
    return normalizeStoredSession((parsed as Partial<SessionMetadataFile>).session, sessionId)
  } catch {
    return null
  }
}

function metadataFilename(sessionId: string): string {
  return `${createHash('sha256').update(sessionId).digest('hex')}.json`
}

export class SessionStore {
  private readonly sessionsDir: string

  constructor(sessionsDir = getPiAcpSessionsDir()) {
    this.sessionsDir = sessionsDir
  }

  private metadataPath(sessionId: string): string {
    return join(this.sessionsDir, metadataFilename(sessionId))
  }

  get(sessionId: string): StoredSession | null {
    return loadMetadataFile(this.metadataPath(sessionId), sessionId)
  }

  upsert(entry: {
    sessionId: string
    cwd: string
    sessionFile: string
    systemPrompt?: SystemPrompt
    sessionTitle?: string
  }): void {
    const existing = this.get(entry.sessionId)
    const systemPrompt = entry.systemPrompt ?? existing?.systemPrompt
    const sessionTitle = entry.sessionTitle ?? existing?.sessionTitle
    const session: StoredSession = {
      sessionId: entry.sessionId,
      cwd: entry.cwd,
      sessionFile: entry.sessionFile,
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(sessionTitle ? { sessionTitle } : {}),
      updatedAt: new Date().toISOString()
    }
    saveFileAtomically(this.metadataPath(entry.sessionId), { version: 1, session })
  }

  delete(sessionId: string): void {
    try {
      unlinkSync(this.metadataPath(sessionId))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
