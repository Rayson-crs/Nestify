import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type StartupLog = (event: string, details?: unknown) => void

export function logStartup(event: string, details?: unknown): void {
  const entry = { timestamp: new Date().toISOString(), event, details }
  try {
    const logsDir = join(app.getPath('userData'), 'logs')
    mkdirSync(logsDir, { recursive: true })
    appendFileSync(join(logsDir, 'startup.log'), `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (error) {
    console.error('[Nestify startup log] failed to write', error)
  }

  if (details === undefined) console.info(`[Nestify startup] ${event}`)
  else console.info(`[Nestify startup] ${event}`, details)
}
