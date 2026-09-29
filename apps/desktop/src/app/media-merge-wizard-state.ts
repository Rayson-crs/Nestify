export type WizardMergeProgress = {
  jobId: string
  status: string
}

export function wizardMergeRunning(progress: WizardMergeProgress | null): boolean {
  return progress?.status === 'running' || progress?.status === 'cancelling'
}

// Background merges keep running on the jobs page. Their progress must not
// become the wizard lock after the wizard has detached that job.
export function nextWizardMergeProgress<T extends WizardMergeProgress>(
  current: T | null,
  incoming: T,
  detachedJobIds: ReadonlySet<string>,
): T | null {
  if (detachedJobIds.has(incoming.jobId)) {
    return current?.jobId === incoming.jobId ? null : current
  }
  if (!current || current.jobId === incoming.jobId) return incoming
  return current
}
