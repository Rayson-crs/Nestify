export class MediaMergeCancelledError extends Error {
  constructor() {
    super('媒体合并已取消')
    this.name = 'MediaMergeCancelledError'
  }
}

export class MediaMergeInterruptedError extends Error {
  constructor() {
    super('媒体合并已中断，可从任务详情恢复')
    this.name = 'MediaMergeInterruptedError'
  }
}
