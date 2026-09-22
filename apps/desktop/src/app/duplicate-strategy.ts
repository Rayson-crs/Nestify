import type { ChangePlan, DuplicateGroup, KeepStrategy } from '@/lib/ipc'
import { isWithinDirectory } from '@/lib/path-crumbs'

export function compareKeepHit(
  a: DuplicateGroup['files'][number],
  b: DuplicateGroup['files'][number],
  strategy: KeepStrategy,
  preferredDirectory = '',
): number {
  switch (strategy) {
    case 'newest':
      return b.mtime - a.mtime || a.path.localeCompare(b.path)
    case 'oldest':
      return a.mtime - b.mtime || a.path.localeCompare(b.path)
    case 'shortest_path':
      return a.path.length - b.path.length || a.path.localeCompare(b.path)
    case 'longest_path':
      return b.path.length - a.path.length || a.path.localeCompare(b.path)
    case 'shortest_name':
      return a.name.length - b.name.length || a.path.localeCompare(b.path)
    case 'longest_name':
      return b.name.length - a.name.length || a.path.localeCompare(b.path)
    case 'name_quality':
      return nameQualityScore(a) - nameQualityScore(b) || a.path.localeCompare(b.path)
    case 'preferred_dir':
      return (
        Number(!isWithinDirectory(a.path, preferredDirectory)) - Number(!isWithinDirectory(b.path, preferredDirectory))
        || b.mtime - a.mtime
        || a.path.localeCompare(b.path)
      )
    default:
      return 0
  }
}

export function applyKeepStrategyToGroups(
  groups: DuplicateGroup[],
  strategy: KeepStrategy,
  preferredDirectory = '',
): DuplicateGroup[] {
  return groups.map((group) => {
    const sorted = [...group.files].sort((a, b) => compareKeepHit(a, b, strategy, preferredDirectory))
    const files = sorted.map((file, index) => ({ ...file, keep: index === 0 }))
    return {
      ...group,
      files,
      wastedBytes: files.reduce((sum, file) => (file.keep ? sum : sum + file.size), 0),
    }
  })
}

export function ensureDuplicateLoserOps(plan: ChangePlan, groups: DuplicateGroup[]): ChangePlan {
  const ops = [...plan.ops]
  const firstOpIndexByEntryId = new Map<string, number>()
  const firstOpIndexByPath = new Map<string, number>()
  const knownIds = new Set<string>()
  const knownPaths = new Set<string>()
  ops.forEach((op, index) => {
    if (op.entryId) {
      if (!firstOpIndexByEntryId.has(op.entryId)) firstOpIndexByEntryId.set(op.entryId, index)
      knownIds.add(op.entryId)
    }
    if (!firstOpIndexByPath.has(op.from)) firstOpIndexByPath.set(op.from, index)
    knownPaths.add(op.from)
  })

  for (const group of groups) {
    let templateIndex = Number.POSITIVE_INFINITY
    for (const file of group.files) {
      const entryOpIndex = file.entryId ? firstOpIndexByEntryId.get(file.entryId) : undefined
      const pathOpIndex = firstOpIndexByPath.get(file.path)
      const matchedIndex = entryOpIndex ?? pathOpIndex
      if (matchedIndex !== undefined && matchedIndex < templateIndex) templateIndex = matchedIndex
    }
    const template = templateIndex === Number.POSITIVE_INFINITY ? undefined : ops[templateIndex]
    for (const file of group.files) {
      if (file.keep || knownIds.has(file.entryId) || knownPaths.has(file.path) || !template) continue
      const to = template.to ? template.to.replace(/[^\\/]+$/, file.name) : null
      ops.push({ ...template, from: file.path, to, entryId: file.entryId, selected: true })
      knownIds.add(file.entryId)
      knownPaths.add(file.path)
    }
  }
  return { ...plan, ops }
}

export function syncDuplicateSelectedOps(
  groups: DuplicateGroup[],
  plan: ChangePlan,
): Record<number, boolean> {
  const filesById = new Map<string, DuplicateGroup['files'][number]>()
  const filesByPath = new Map<string, DuplicateGroup['files'][number]>()
  for (const group of groups) {
    for (const file of group.files) {
      if (!filesById.has(file.entryId)) filesById.set(file.entryId, file)
      if (!filesByPath.has(file.path)) filesByPath.set(file.path, file)
    }
  }

  const map: Record<number, boolean> = {}
  plan.ops.forEach((op, index) => {
    const file = (op.entryId ? filesById.get(op.entryId) : undefined) ?? filesByPath.get(op.from)
    map[index] = file ? !file.keep : false
  })
  return map
}

function nameQualityScore(file: DuplicateGroup['files'][number]): number {
  const name = file.name.toLowerCase()
  let score = 0
  if (/\bcopy\b|\b副本\b|\(?\d+\)?(?:\.\w+)?$/.test(name)) score += 40
  if (/\[[^\]]+\]|\([^)]*\)|【[^】]*】/.test(name)) score += 20
  if (/[-_.\s]{2,}/.test(name)) score += 10
  if (/^\d+(?:\.\w+)?$/.test(name)) score += 20
  if (name.length < 3) score += 10
  return score
}
