import { Worker } from 'node:worker_threads'
import { walkRoot, type WalkedEntry, type WalkOptions, type WalkErrorDetail } from './walk.ts'
import type { WalkTask, WalkTaskOptions, WalkTaskResult } from './walk-task.ts'

const MAX_QUEUED_DIRECTORIES = 4096
const EVENT_LOOP_INTERVAL = 256

type WorkerMessage =
  | { type: 'result'; result: WalkTaskResult }
  | { type: 'result'; result: WalkTaskResult & { error?: string } }

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function workerEntryPoint(): URL {
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.mjs'
  return new URL(`./walk-worker${extension}`, import.meta.url)
}

export async function* walkRootConcurrent(
  rootInput: string,
  options: WalkOptions & { concurrency?: number } = {},
): AsyncGenerator<WalkedEntry> {
  const concurrency = Math.max(1, Math.min(32, Math.trunc(options.concurrency ?? 1)))
  if (concurrency === 1) {
    yield* walkRoot(rootInput, options)
    return
  }

  const walkOptions: WalkTaskOptions = {
    followSymlinks: options.followSymlinks,
    scanHidden: options.scanHidden,
    maxDepth: options.maxDepth,
    exclude: options.exclude,
  }
  const taskOptions = structuredClone(walkOptions)
  const workers: Worker[] = []
  const idleWorkers: number[] = []
  const tasks: WalkTask[] = [{
    root: rootInput,
    path: rootInput,
    parentPath: null,
    depth: 0,
  }]
  const deferredTasks: WalkTask[] = []
  const inbox = new Map<string, WalkedEntry>()
  const waiters: Array<() => void> = []
  let activeTasks = 0
  let closed = false
  let failure: Error | null = null
  let emitted = 0
  const seenPaths = new Set<string>()
  const queuedDirectories = new Set<string>()

  const rememberNode = (node: WalkedEntry): WalkedEntry | null => {
    const isHint = node.mtime == null && node.size === 0 && node.ino == null
    const existing = inbox.get(node.path)
    if (existing) {
      if (!isHint) inbox.set(node.path, node)
      return null
    }
    if (seenPaths.has(node.path) && isHint) return null
    seenPaths.add(node.path)
    return node
  }
  const queueDirectory = (task: WalkTask) => {
    if (queuedDirectories.has(task.path)) return
    queuedDirectories.add(task.path)
    if (tasks.length < MAX_QUEUED_DIRECTORIES) tasks.push(task)
    else deferredTasks.push(task)
  }

  const wake = () => {
    while (waiters.length > 0) waiters.shift()?.()
  }
  const closeWorkers = () => {
    if (closed) return
    closed = true
    for (const worker of workers) {
      if (failure) worker.terminate()
      else worker.postMessage({ type: 'close' })
    }
    wake()
  }
  const drain = () => {
    if (closed) return
    // Keep the active task queue bounded, but retain overflow for later
    // scheduling. A large directory must apply backpressure, not abort the
    // whole scan after its first few thousand children.
    while (tasks.length < MAX_QUEUED_DIRECTORIES && deferredTasks.length > 0) {
      const task = deferredTasks.shift()
      if (!task) break
      tasks.push(task)
    }
    while (idleWorkers.length > 0 && tasks.length > 0 && activeTasks < concurrency * 2) {
      const workerIndex = idleWorkers.shift()
      const task = tasks.shift()
      if (workerIndex == null || !task) break
      activeTasks += 1
      workers[workerIndex]?.postMessage({ type: 'inspect', task, options: taskOptions })
    }
    if (activeTasks === 0 && tasks.length === 0 && deferredTasks.length === 0) closeWorkers()
  }

  for (let index = 0; index < concurrency; index += 1) {
    const worker = new Worker(workerEntryPoint())
    workers.push(worker)
    idleWorkers.push(index)
    worker.on('message', (message: WorkerMessage) => {
      if (message.result.failed) {
        const errors = message.result.errors ?? [{
          path: message.result.task.path,
          operation: 'worker' as const,
          message: 'walk task failed without an error detail',
        } satisfies WalkErrorDetail]
        for (const error of errors) options.onTaskError?.(error)
      }
      for (const node of message.result.nodes) {
        const next = rememberNode(node)
        if (next) inbox.set(next.path, next)
      }
      if (message.result.directories.length > 0) {
        for (const directory of message.result.directories) queueDirectory(directory)
      }
      if (message.result.done !== false) {
        activeTasks -= 1
        idleWorkers.push(index)
      }
      drain()
      wake()
    })
    worker.on('error', (error) => {
      failure = error
      closeWorkers()
    })
    worker.on('exit', (code) => {
      if (code !== 0 && !closed) {
        failure = new Error(`scan worker exited with code ${code}`)
        closeWorkers()
      }
    })
  }

  drain()
  try {
    while (!closed || inbox.size > 0) {
      if (failure) throw failure
      if (inbox.size === 0) {
        await new Promise<void>((resolve) => waiters.push(resolve))
        continue
      }
      const [path, node] = inbox.entries().next().value ?? [null, null]
      if (path != null && node) {
        inbox.delete(path)
        yield node
      }
      emitted += 1
      if (emitted % EVENT_LOOP_INTERVAL === 0) await yieldToEventLoop()
      if (options.signal?.aborted) closeWorkers()
    }
  } finally {
    failure ??= options.signal?.aborted ? null : failure
    closeWorkers()
  }
}
