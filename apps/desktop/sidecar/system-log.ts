import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_LOG_BYTES = 30 * 1024 * 1024
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const LOG_FILE_PATTERN = /^sys_\d{4}-\d{2}-\d{2}(?:_\d{3})?\.log$/

export type SystemLogLevel = 'info' | 'warn' | 'error'

type SystemRecord = {
  timestamp: string
  level: SystemLogLevel
  event: string
  pid: number
  component?: string
  details?: unknown
}

export class SystemLogger {
  private logsDir: string
  private maxBytes: number
  private retentionMs: number
  private cleanupIntervalMs: number
  private currentFile: string | null = null
  private currentSize = 0
  private queue: Promise<void> = Promise.resolve()
  private initialized = false
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(logsDir: string, options: {
    maxBytes?: number
    retentionMs?: number
    cleanupIntervalMs?: number
  } = {}) {
    this.logsDir = logsDir
    this.maxBytes = options.maxBytes ?? MAX_LOG_BYTES
    this.retentionMs = options.retentionMs ?? RETENTION_MS
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? CLEANUP_INTERVAL_MS
    this.queue = this.initialize().catch((error) => {
      console.error('[nestify-system] logger initialization failed', error)
    })
    this.resetCleanupTimer()
  }

  configure(options: {
    logsDir?: string
    maxBytes?: number
    retentionMs?: number
    cleanupIntervalMs?: number
  }): Promise<void> {
    this.enqueue(async () => {
      const nextDir = options.logsDir ?? this.logsDir
      if (nextDir !== this.logsDir) {
        this.logsDir = nextDir
        this.initialized = false
        this.currentFile = null
        this.currentSize = 0
      }
      this.maxBytes = options.maxBytes ?? this.maxBytes
      this.retentionMs = options.retentionMs ?? this.retentionMs
      this.cleanupIntervalMs = options.cleanupIntervalMs ?? this.cleanupIntervalMs
      await this.initialize()
    })
    this.resetCleanupTimer()
    return this.flush()
  }

  log(event: string, details?: unknown, level: SystemLogLevel = 'info'): void {
    const record: SystemRecord = {
      timestamp: new Date().toISOString(),
      level,
      event,
      pid: process.pid,
      component: componentForEvent(event),
      ...(details === undefined ? {} : { details: normalizeValue(details) }),
    }
    this.enqueue(async () => {
      await this.initialize()
      await this.write(`${JSON.stringify(record)}\n`)
    })
  }

  flush(): Promise<void> {
    return this.queue
  }

  private enqueue(operation: () => Promise<void>): void {
    this.queue = this.queue.then(operation, operation).catch((error) => {
      console.error('[nestify-system] logger write failed', error)
    })
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return
    await mkdir(this.logsDir, { recursive: true })
    const now = Date.now()
    const existing = await this.findExistingFiles()
    let newestMtime = Number.NEGATIVE_INFINITY
    for (const file of existing) {
      const info = await stat(join(this.logsDir, file.name))
      if (info.mtimeMs > newestMtime) {
        newestMtime = info.mtimeMs
        this.currentFile = join(this.logsDir, file.name)
      }
    }
    if (this.currentFile) {
      const info = await stat(this.currentFile)
      if (now - info.mtimeMs >= this.retentionMs) {
        this.currentFile = null
        this.currentSize = 0
      } else {
        this.currentSize = info.size
      }
    }
    await this.cleanup(now)
    this.initialized = true
  }

  private resetCleanupTimer(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    this.cleanupTimer = setInterval(() => {
      this.enqueue(async () => {
        await this.initialize()
        await this.cleanup(Date.now())
      })
    }, this.cleanupIntervalMs)
    this.cleanupTimer.unref?.()
  }

  private async write(line: string): Promise<void> {
    if (!this.currentFile || this.currentSize >= this.maxBytes) {
      this.currentFile = await this.createRotatedFile()
      this.currentSize = 0
    }
    const bytes = Buffer.byteLength(line)
    await appendFile(this.currentFile, line)
    this.currentSize += bytes
  }

  private async createRotatedFile(): Promise<string> {
    const date = formatDate(new Date())
    const existing = new Set((await this.findExistingFiles()).map((file) => file.name))
    let sequence = 0
    let name = `sys_${date}.log`
    while (existing.has(name)) {
      sequence += 1
      name = `sys_${date}_${String(sequence).padStart(3, '0')}.log`
    }
    return join(this.logsDir, name)
  }

  private async findExistingFiles(): Promise<Array<{ name: string; mtimeMs: number }>> {
    const names = await readdir(this.logsDir).catch(() => [])
    const files: Array<{ name: string; mtimeMs: number }> = []
    for (const name of names) {
      if (!LOG_FILE_PATTERN.test(name)) continue
      const info = await stat(join(this.logsDir, name)).catch(() => null)
      if (info?.isFile()) files.push({ name, mtimeMs: info.mtimeMs })
    }
    return files.sort((a, b) => a.mtimeMs - b.mtimeMs)
  }

  private async cleanup(now: number): Promise<void> {
    const current = this.currentFile
    const files = await this.findExistingFiles()
    for (const file of files) {
      if (current && join(this.logsDir, file.name) === current) continue
      if (now - file.mtimeMs >= this.retentionMs) {
        await unlink(join(this.logsDir, file.name)).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        })
      }
    }
  }
}

function componentForEvent(event: string): string {
  if (/^(sidecar|runtime|process|http)\./.test(event)) return 'lifecycle'
  if (/^(renderer|spotlight)\./.test(event)) return 'renderer'
  if (/^(rpc|log)\./.test(event)) return 'ipc'
  if (/^(scan|search|directory|index)\./.test(event)) return 'data'
  if (/^(mediaMerge|plan|duplicates|library|file)\./.test(event)) return 'task'
  if (/^writer\.|^query\.|^preview\.|^scan-worker\./.test(event)) return 'worker'
  return 'system'
}

function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function normalizeValue(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }
  if (value == null || typeof value !== 'object') return value
  if (depth >= 5) return '[max-depth]'
  if (Array.isArray(value)) {
    return {
      type: 'array',
      count: value.length,
      items: value.slice(0, 20).map((item) => normalizeValue(item, depth + 1)),
    }
  }
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(source).slice(0, 100)) {
    result[key] = normalizeValue(source[key], depth + 1)
  }
  return result
}
