import { parentPort } from 'node:worker_threads'
import { inspectWalkTask, type WalkTask, type WalkTaskOptions } from './walk-task.ts'

const port = parentPort
if (!port) throw new Error('walk-worker requires a worker parent port')

port.on('message', (message: { type: 'inspect'; task: WalkTask; options: WalkTaskOptions } | { type: 'close' }) => {
  if (message.type === 'close') {
    port.close()
    return
  }
  const options: WalkTaskOptions = {
    ...message.options,
    onPartial: (result) => port.postMessage({ type: 'result', result }),
  }
  void inspectWalkTask(message.task, options)
    .then((result) => port.postMessage({ type: 'result', result }))
    .catch((error: unknown) => port.postMessage({
      type: 'result',
      result: {
        task: message.task,
        nodes: [],
        directories: [],
        failed: true,
        done: true,
        errors: [{
          path: message.task.path,
          operation: 'worker',
          message: error instanceof Error ? error.message : String(error),
        }],
        error: error instanceof Error ? error.message : String(error),
      },
    }))
})
