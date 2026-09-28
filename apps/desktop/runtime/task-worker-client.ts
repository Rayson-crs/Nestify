import { Worker } from 'node:worker_threads'

type TaskWorkerMessage =
  | { type: 'progress'; progress: unknown }
  | { type: 'completed'; result: unknown }
  | { type: 'failed'; error: string; name?: string }
  | { type: 'cancel' }

type TaskWorkerInboundMessage = Exclude<TaskWorkerMessage, { type: 'cancel' }>

type CancellableTaskPromise<T> = Promise<T> & { cancel: () => void }

function workerExecArgv(): string[] {
  return process.execArgv.filter((argument) =>
    argument === '--experimental-strip-types' || argument === '--experimental-transform-types')
}

export function runTaskWorker<T>(input: {
  workerPath: string
  dbPath: string
  quarantineDir: string
  task: unknown
  onProgress?: (progress: unknown) => void
}): CancellableTaskPromise<T> {
  const worker = new Worker(input.workerPath, {
    type: 'module',
    workerData: {
      dbPath: input.dbPath,
      quarantineDir: input.quarantineDir,
      task: input.task,
    },
    execArgv: workerExecArgv(),
  })

  const execution = new Promise<T>((resolve, reject) => {
    let settled = false
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
    }

    worker.on('message', (message: TaskWorkerInboundMessage) => {
      try {
        if (message.type === 'progress') {
          input.onProgress?.(message.progress)
          return
        }
        if (message.type === 'completed') {
          settle(() => {
            void worker.terminate().finally(() => resolve(message.result as T))
          })
          return
        }
        settle(() => {
          void worker.terminate().finally(() => {
            const error = new Error(message.error)
            error.name = message.name || 'Error'
            reject(error)
          })
        })
      } catch (error) {
        settle(() => {
          void worker.terminate().finally(() => reject(error))
        })
      }
    })
    worker.on('error', (error) => {
      settle(() => {
        void worker.terminate().finally(() => reject(error))
      })
    })
    worker.on('exit', (code) => {
      settle(() => reject(new Error(`task worker exited with code ${code}`)))
    })
  }) as CancellableTaskPromise<T>
  execution.cancel = () => worker.postMessage({ type: 'cancel' } satisfies TaskWorkerMessage)
  return execution
}
