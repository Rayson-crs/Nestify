import test from 'node:test'
import assert from 'node:assert/strict'
import { nextWizardMergeProgress, wizardMergeRunning } from './media-merge-wizard-state.ts'

const background = { jobId: 'job-background', status: 'running' as const }
const foreground = { jobId: 'job-foreground', status: 'running' as const }

test('a detached background merge does not relock the wizard', () => {
  const detached = new Set([background.jobId])
  const afterReset = nextWizardMergeProgress(null, background, detached)
  const stillDetached = nextWizardMergeProgress(afterReset, { ...background, status: 'completed' }, detached)
  const nextTask = nextWizardMergeProgress(stillDetached, foreground, detached)

  assert.equal(afterReset, null)
  assert.equal(stillDetached, null)
  assert.equal(wizardMergeRunning(afterReset), false)
  assert.equal(wizardMergeRunning(nextTask), true)
  assert.equal(nextTask?.jobId, foreground.jobId)
})

test('foreground progress still locks only the active wizard job', () => {
  const started = nextWizardMergeProgress(null, foreground, new Set())
  const updated = nextWizardMergeProgress(started, { ...foreground, status: 'cancelling' }, new Set())
  const otherJob = nextWizardMergeProgress(updated, background, new Set())

  assert.equal(wizardMergeRunning(started), true)
  assert.equal(wizardMergeRunning(updated), true)
  assert.equal(otherJob?.jobId, foreground.jobId)
  assert.equal(wizardMergeRunning({ ...foreground, status: 'completed' }), false)
})
