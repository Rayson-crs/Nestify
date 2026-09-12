import { Worker } from 'node:worker_threads'

export type LibraryRemovalWorkerProgress = {
  stage: string
  current: number
  total: number
}

type WorkerMessage =
  | { type: 'progress'; stage: string; current: number; total: number }
  | { type: 'completed' }
  | { type: 'failed'; error: string }

export async function removeLibraryInWorker(input: {
  workerPath: string
  dbPath: string
  libraryId: string
  preserveJobId: string
  thumbnailsDir: string
  onProgress?: (progress: LibraryRemovalWorkerProgress) => void
}): Promise<void> {
  const worker = new Worker(input.workerPath, {
    type: 'module',
    workerData: {
      dbPath: input.dbPath,
      libraryId: input.libraryId,
      preserveJobId: input.preserveJobId,
      thumbnailsDir: input.thumbnailsDir,
    },
    execArgv: process.execArgv.filter((argument) => !argument.startsWith('--input-type')),
  })

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
    }

    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'progress') {
        input.onProgress?.(message)
        return
      }
      if (message.type === 'completed') {
        settle(() => {
          void worker.terminate().finally(resolve)
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
      if (code !== 0) {
        settle(() => reject(new Error(`library removal worker exited with code ${code}`)))
      }
    })
  })
}
