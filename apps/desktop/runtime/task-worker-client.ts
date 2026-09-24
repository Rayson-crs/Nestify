import { Worker } from 'node:worker_threads'

type TaskWorkerMessage =
  | { type: 'progress'; progress: unknown }
  | { type: 'completed'; result: unknown }
  | { type: 'failed'; error: string }

export function runTaskWorker<T>(input: {
  workerPath: string
  dbPath: string
  quarantineDir: string
  task: unknown
  onProgress?: (progress: unknown) => void
}): Promise<T> {
  const worker = new Worker(input.workerPath, {
    type: 'module',
    workerData: {
      dbPath: input.dbPath,
      quarantineDir: input.quarantineDir,
      task: input.task,
    },
    execArgv: process.execArgv.filter((argument) => !argument.startsWith('--input-type')),
  })

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
    }

    worker.on('message', (message: TaskWorkerMessage) => {
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
        void worker.terminate().finally(() => reject(new Error(message.error)))
      })
    })
    worker.on('error', (error) => {
      settle(() => {
        void worker.terminate().finally(() => reject(error))
      })
    })
    worker.on('exit', (code) => {
      settle(() => reject(new Error(`task worker exited with code ${code}`)))
    })
  })
}
