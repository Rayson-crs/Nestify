import type { ChangePlan } from '@/lib/ipc'
import type { PlanSource } from '@/lib/workspace'

export type PlanState = {
  plan: ChangePlan
  source: PlanSource
  fingerprint: string
}
