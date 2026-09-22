import { useCallback, useEffect, useMemo, useState } from 'react'
import { callNestify, getNestifyApi, type MediaMergeImageSettings, type MediaMergeItem, type MediaMergeKind, type MediaMergeOrderCriterion, type MediaMergeOrderProfile, type MediaMergeOrderRule, type MediaMergePlan, type MediaMergeProgress, type MediaMergeSelectedFile, type MediaMergeVideoSettings, type SearchHit } from '@/lib/ipc'
import type { MediaMergeImageMotion } from '@/lib/ipc'
import { errorMessage } from '@/lib/labels'
import { applyLocalOrder, clampNumber, createMediaMergeItem, parentDirectory, replaceExtension, samePathKey } from './media-merge-utils'

export type MediaMergeStep = 1 | 2 | 3
export type MediaMergeBatchApplyMode = 'non-custom' | 'all'
export type MediaMergeAudioPatch = Partial<Pick<
  MediaMergeItem,
  'volume' | 'muted' | 'audioFadeInSeconds' | 'audioFadeOutSeconds'
>>

const DEFAULT_IMAGE_SETTINGS: MediaMergeImageSettings = {
  format: 'jpg',
  layout: 'vertical',
  width: 1080,
  height: 1080,
  columns: 2,
  gap: 8,
  background: 'white',
}

const DEFAULT_VIDEO_SETTINGS: MediaMergeVideoSettings = {
  format: 'mp4',
  quality: 'standard',
  audio: 'keep',
  encodingMode: 'auto',
  transition: { type: 'none', durationSeconds: 0 },
  outputVolume: 1,
}

export function useMediaMerge({
  ipcReady,
  setError,
  setNotice,
  loadJobs,
}: {
  ipcReady: boolean
  setError: (message: string | null) => void
  setNotice: (message: string | null) => void
  loadJobs: (options?: { preferJobId?: string }) => Promise<void>
}) {
  const [step, setStep] = useState<MediaMergeStep>(1)
  const [items, setItems] = useState<MediaMergeItem[]>([])
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [orderRule, setOrderRuleState] = useState<MediaMergeOrderRule>('manual')
  const [orderProfile, setOrderProfileState] = useState<MediaMergeOrderProfile>({ criteria: [] })
  const [outputDirectory, setOutputDirectoryState] = useState('')
  const [outputName, setOutputNameState] = useState('')
  const [imageSettings, setImageSettingsState] = useState(DEFAULT_IMAGE_SETTINGS)
  const [videoSettings, setVideoSettingsState] = useState(DEFAULT_VIDEO_SETTINGS)
  const [batchTrimStart, setBatchTrimStartState] = useState(0)
  const [batchTrimEnd, setBatchTrimEndState] = useState<number | null>(null)
  const [plan, setPlan] = useState<MediaMergePlan | null>(null)
  const [progress, setProgress] = useState<MediaMergeProgress | null>(null)
  const [busy, setBusy] = useState(false)

  const taskKind: MediaMergeKind | null = items.some((item) => item.kind === 'video')
    ? 'video'
    : items.some((item) => item.kind === 'image')
      ? 'image'
      : null
  const kind = taskKind
  const hasMixedMedia = taskKind === 'image' && items.some((item) => item.kind === 'video')
  const running = progress?.status === 'running' || progress?.status === 'cancelling'
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? items[0] ?? null
  const canArrange = items.length >= (kind === 'image' ? 2 : 1) && !hasMixedMedia

  const invalidatePlan = useCallback(() => {
    if (running) return
    setPlan(null)
    setProgress(null)
  }, [running])

  const ensureOutputDefaults = useCallback((nextItems: MediaMergeItem[], nextKind: MediaMergeKind | null) => {
    if (!nextItems[0] || !nextKind) return
    setOutputDirectoryState((current) => current.trim() || parentDirectory(nextItems[0].path))
    setOutputNameState((current) => {
      if (current.trim()) return current
      return nextKind === 'image' ? 'nestify-merge.jpg' : 'nestify-merge.mp4'
    })
  }, [])

  const appendFiles = useCallback((files: MediaMergeSelectedFile[], mode: 'replace' | 'append') => {
    if (running) return
    invalidatePlan()
    const existing = new Set(items.map((item) => samePathKey(item.path)))
    const additions: MediaMergeItem[] = []
    for (const file of files) {
      if (existing.has(samePathKey(file.path))) continue
      existing.add(samePathKey(file.path))
      additions.push(createMediaMergeItem(file, batchTrimStart, batchTrimEnd))
    }
    const base = mode === 'replace' ? [] : items
    const next = [...base, ...additions].map((item, index) => ({ ...item, orderIndex: index }))
    setItems(next)
    ensureOutputDefaults(next, next[0]?.kind ?? null)
    if (next[0]) setSelectedItemId((selected) => (mode === 'replace' || !selected ? next[0].id : selected))
    if (next.length >= 2 && new Set(next.map((item) => item.kind)).size === 1) setStep(2)
    else setStep(1)
  }, [batchTrimEnd, batchTrimStart, ensureOutputDefaults, invalidatePlan, items, running])

  const importFromSearch = useCallback((hits: SearchHit[], entryIds: string[]) => {
    const idSet = new Set(entryIds)
    const selected = hits.filter((hit) => idSet.has(hit.entryId) && (hit.kind === 'image' || hit.kind === 'video'))
    if (selected.length === 0) {
      setError('请先选择图片或视频文件')
      return
    }
    appendFiles(
      selected.map((hit) => ({
        path: hit.path,
        kind: hit.kind as 'image' | 'video',
        size: hit.size,
        mtime: hit.mtime,
      })),
      'append',
    )
    setNotice(`已加入 ${selected.length} 个媒体文件`)
  }, [appendFiles, setError, setNotice])

  const selectFiles = useCallback(async () => {
    if (!ipcReady || running) return
    setBusy(true)
    setError(null)
    try {
      const { files } = await callNestify((api) =>
        api.mediaMergeSelectFiles
          ? api.mediaMergeSelectFiles()
          : Promise.reject(new Error('mediaMerge.selectFiles is unavailable')),
      )
      if (files.length > 0) appendFiles(files, 'append')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [appendFiles, ipcReady, running, setError])

  const removeItem = useCallback((itemId: string) => {
    if (running) return
    invalidatePlan()
    const next = items
      .filter((item) => item.id !== itemId)
      .map((item, index) => ({ ...item, orderIndex: index }))
    setItems(next)
    if (next.length < (kind === 'image' ? 2 : 1)) setStep(1)
    setSelectedItemId((selected) => (selected === itemId ? next[0]?.id ?? null : selected))
  }, [invalidatePlan, items, running])

  const setOrderRule = useCallback((nextRule: MediaMergeOrderRule) => {
    if (running) return
    invalidatePlan()
    setOrderRuleState(nextRule)
    setItems((current) => applyLocalOrder(current, nextRule, orderProfile))
  }, [invalidatePlan, orderProfile, running])

  const setOrderCriteria = useCallback((criteria: MediaMergeOrderCriterion[]) => {
    if (running) return
    invalidatePlan()
    const nextProfile = { criteria }
    const nextRule: MediaMergeOrderRule = criteria.length > 0 ? 'rules' : 'manual'
    setOrderProfileState(nextProfile)
    setOrderRuleState(nextRule)
    setItems((current) => applyLocalOrder(
      current.map((item) => ({ ...item, manualOrder: false })),
      nextRule,
      nextProfile,
    ))
  }, [invalidatePlan, running])

  const reorderOrderCriteria = useCallback((from: number, to: number) => {
    if (running || from === to || from < 0 || to < 0 || from >= orderProfile.criteria.length || to >= orderProfile.criteria.length) return
    const criteria = [...orderProfile.criteria]
    const [moved] = criteria.splice(from, 1)
    if (!moved) return
    criteria.splice(to, 0, moved)
    setOrderCriteria(criteria)
  }, [orderProfile.criteria, running, setOrderCriteria])

  const clearManualOrder = useCallback(() => {
    if (running) return
    invalidatePlan()
    setItems((current) => applyLocalOrder(
      current.map((item) => ({ ...item, manualOrder: false })),
      orderRule,
      orderProfile,
    ))
  }, [invalidatePlan, orderProfile, orderRule, running])

  const moveItem = useCallback((itemId: string, direction: -1 | 1) => {
    if (running) return
    invalidatePlan()
    setItems((current) => {
      const index = current.findIndex((item) => item.id === itemId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      const moved = { ...next[index]!, manualOrder: orderRule === 'manual' ? next[index]!.manualOrder : true }
      const swapped = { ...next[target]!, manualOrder: orderRule === 'manual' ? next[target]!.manualOrder : true }
      next[index] = swapped
      next[target] = moved
      return next.map((item, position) => ({ ...item, orderIndex: position }))
    })
  }, [invalidatePlan, orderRule, running])

  const moveItemTo = useCallback((itemId: string, targetItemId: string) => {
    if (running || itemId === targetItemId) return
    invalidatePlan()
    setItems((current) => {
      const from = current.findIndex((item) => item.id === itemId)
      const target = current.findIndex((item) => item.id === targetItemId)
      if (from < 0 || target < 0) return current
      const next = [...current]
      const moved = { ...next[from]!, manualOrder: orderRule === 'manual' ? next[from]!.manualOrder : true }
      next.splice(from, 1)
      next.splice(target, 0, moved)
      return next.map((item, position) => ({ ...item, orderIndex: position }))
    })
  }, [invalidatePlan, orderRule, running])

  const setOutputDirectory = useCallback((value: string) => {
    if (running) return
    invalidatePlan()
    setOutputDirectoryState(value)
  }, [invalidatePlan, running])

  const setOutputName = useCallback((value: string) => {
    if (running) return
    invalidatePlan()
    setOutputNameState(value)
  }, [invalidatePlan, running])

  const setImageSettings = useCallback((patch: Partial<MediaMergeImageSettings>) => {
    if (running) return
    invalidatePlan()
    setImageSettingsState((current) => ({
      ...current,
      ...patch,
      ...(patch.width != null ? { width: finiteSetting(patch.width, current.width) } : {}),
      ...(patch.height != null ? { height: finiteSetting(patch.height, current.height ?? 1080) } : {}),
      ...(patch.columns != null ? { columns: finiteSetting(patch.columns, current.columns ?? 2) } : {}),
      ...(patch.gap != null ? { gap: finiteSetting(patch.gap, current.gap) } : {}),
    }))
    if (patch.format) {
      const extension = `.${patch.format}`
      setOutputNameState((name) => (name.trim() ? replaceExtension(name, extension) : `nestify-merge${extension}`))
    }
  }, [invalidatePlan, running])

  const setVideoSettings = useCallback((patch: Partial<MediaMergeVideoSettings>) => {
    if (running) return
    invalidatePlan()
    setVideoSettingsState((current) => ({ ...current, ...patch }))
    if (patch.format) {
      const extension = `.${patch.format}`
      setOutputNameState((name) => (name.trim() ? replaceExtension(name, extension) : `nestify-merge${extension}`))
    }
  }, [invalidatePlan, running])

  const setBatchTrimStart = useCallback((value: number) => {
    setBatchTrimStartState(Math.max(0, value))
  }, [])

  const setBatchTrimEnd = useCallback((value: number | null) => {
    setBatchTrimEndState(value == null ? null : Math.max(0, value))
  }, [])

  const updateItemTrim = useCallback((
    itemId: string,
    field: 'start' | 'end',
    value: number | null,
    duration?: number,
  ) => {
    if (running) return
    invalidatePlan()
    const max = Number.isFinite(duration) && duration ? Math.max(0.1, duration) : undefined
    const normalized = value == null
      ? null
      : Number.isFinite(value)
        ? Math.max(0, max ? Math.min(value, max) : value)
        : 0
    setItems((current) => current.map((item) => {
      if (item.id !== itemId) return item
      const start = field === 'start' ? normalized ?? 0 : item.trimStart
      const endOffset = field === 'end' ? normalized : item.trimEndOffset
      return {
        ...item,
        trimStart: start,
        trimEndOffset: endOffset,
        trimSource: 'custom',
      }
    }))
  }, [invalidatePlan, running])

  const resetItemTrim = useCallback((itemId: string) => {
    if (running) return
    invalidatePlan()
    setItems((current) => current.map((item) => item.id === itemId
      ? { ...item, trimStart: batchTrimStart, trimEndOffset: batchTrimEnd, trimSource: 'batch' }
      : item,
    ))
  }, [batchTrimEnd, batchTrimStart, invalidatePlan, running])

  const updateItemAudio = useCallback((itemId: string, patch: MediaMergeAudioPatch) => {
    if (running) return
    invalidatePlan()
    const next: MediaMergeAudioPatch = {
      ...patch,
      ...(patch.volume != null ? { volume: clampNumber(patch.volume, 0, 4) } : {}),
      ...(patch.audioFadeInSeconds != null
        ? { audioFadeInSeconds: clampNumber(patch.audioFadeInSeconds, 0, 30) }
        : {}),
      ...(patch.audioFadeOutSeconds != null
        ? { audioFadeOutSeconds: clampNumber(patch.audioFadeOutSeconds, 0, 30) }
        : {}),
    }
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, ...next } : item))
  }, [invalidatePlan, running])

  const updateImageClip = useCallback((
    itemId: string,
    patch: { imageDurationSeconds?: number; imageMotion?: MediaMergeImageMotion },
  ) => {
    if (running) return
    invalidatePlan()
    const duration = patch.imageDurationSeconds == null
      ? undefined
      : clampNumber(patch.imageDurationSeconds, 0.2, 120)
    setItems((current) => current.map((item) => item.id === itemId
      ? {
        ...item,
        ...(duration == null ? {} : { imageDurationSeconds: Math.round(duration * 100) / 100 }),
        ...(patch.imageMotion ? { imageMotion: patch.imageMotion } : {}),
      }
      : item))
  }, [invalidatePlan, running])

  const applyBatchTrim = useCallback((mode: MediaMergeBatchApplyMode) => {
    if (running) return
    invalidatePlan()
    setItems((current) => current.map((item) =>
      mode === 'all' || item.trimSource === 'batch'
        ? { ...item, trimStart: batchTrimStart, trimEndOffset: batchTrimEnd, trimSource: 'batch' }
        : item,
    ))
    setNotice(mode === 'all' ? '批量裁剪已覆盖所有视频' : '批量裁剪已应用到未自定义视频')
  }, [batchTrimEnd, batchTrimStart, invalidatePlan, running, setNotice])

  const buildPlan = useCallback(async () => {
    if (!ipcReady || running || !kind || hasMixedMedia || items.length < (kind === 'image' ? 2 : 1)) return null
    setBusy(true)
    setError(null)
    try {
      const next = await callNestify((api) =>
        api.mediaMergeBuildPlan
          ? api.mediaMergeBuildPlan({
            kind,
            items: applyLocalOrder(items, orderRule, orderProfile),
            orderRule,
            orderProfile,
            outputDirectory,
            outputName,
            image: kind === 'image' ? imageSettings : undefined,
            video: kind === 'video' ? videoSettings : undefined,
          })
          : Promise.reject(new Error('mediaMerge.buildPlan is unavailable')),
      )
      setPlan(next)
      return next
    } catch (err) {
      setError(errorMessage(err))
      return null
    } finally {
      setBusy(false)
    }
  }, [hasMixedMedia, imageSettings, ipcReady, items, kind, orderProfile, orderRule, outputDirectory, outputName, running, setError, videoSettings])

  const goNext = useCallback(async () => {
    if (step === 1) {
      if (!canArrange) return
      setStep(2)
      return
    }
    if (step === 2) {
      setStep(3)
      await buildPlan()
    }
  }, [buildPlan, canArrange, step])

  const goBack = useCallback(() => {
    if (running) return
    setStep((current) => (current === 3 ? 2 : 1))
  }, [running])

  const pickOutputDirectory = useCallback(async () => {
    if (!ipcReady || running) return
    try {
      const picked = await callNestify((api) => api.pickDirectory())
      if (picked?.path) setOutputDirectory(picked.path)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [ipcReady, running, setError])

  const start = useCallback(async () => {
    if (!ipcReady || running || !plan) return
    setBusy(true)
    setError(null)
    try {
      const result = await callNestify((api) =>
        api.mediaMergeStart
          ? api.mediaMergeStart({ plan })
          : Promise.reject(new Error('mediaMerge.start is unavailable')),
      )
      setProgress(result.progress)
      void loadJobs({ preferJobId: result.jobId }).catch(() => undefined)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [ipcReady, loadJobs, plan, running, setError])

  const cancel = useCallback(async () => {
    if (!ipcReady || !progress || progress.status !== 'running') return
    try {
      await callNestify((api) =>
        api.mediaMergeCancel
          ? api.mediaMergeCancel({ jobId: progress.jobId })
          : Promise.reject(new Error('mediaMerge.cancel is unavailable')),
      )
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [ipcReady, progress, setError])

  const revealOutput = useCallback(async (path: string) => {
    try {
      await callNestify((api) => api.shellReveal({ path }))
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [setError])

  const reset = useCallback(() => {
    if (running) return
    setStep(1)
    setItems([])
    setSelectedItemId(null)
    setPlan(null)
    setProgress(null)
    setOutputDirectoryState('')
    setOutputNameState('')
  }, [running])

  useEffect(() => {
    if (!ipcReady) return
    const api = getNestifyApi()
    if (!api?.onMediaMergeProgress) return
    return api.onMediaMergeProgress((next) => {
      setProgress((current) => !current || current.jobId === next.jobId ? next : current)
    })
  }, [ipcReady])

  useEffect(() => {
    if (progress?.status !== 'completed' && progress?.status !== 'failed' && progress?.status !== 'cancelled') return
    void loadJobs({ preferJobId: progress.jobId }).catch(() => undefined)
  }, [loadJobs, progress?.jobId, progress?.status])

  return useMemo(() => ({
    step,
    items,
    kind,
    hasMixedMedia,
    selectedItem,
    selectedItemId: selectedItem?.id ?? null,
    orderRule,
    orderProfile,
    outputDirectory,
    outputName,
    imageSettings,
    videoSettings,
    batchTrimStart,
    batchTrimEnd,
    plan,
    progress,
    busy: busy || running,
    running,
    canArrange,
    importFromSearch,
    selectFiles,
    removeItem,
    setStep,
    setOrderRule,
    setOrderCriteria,
    reorderOrderCriteria,
    clearManualOrder,
    moveItem,
    moveItemTo,
    setSelectedItemId,
    setOutputDirectory,
    setOutputName,
    setImageSettings,
    setVideoSettings,
    setBatchTrimStart,
    setBatchTrimEnd,
    updateItemTrim,
    resetItemTrim,
    updateItemAudio,
    updateImageClip,
    applyBatchTrim,
    buildPlan,
    goNext,
    goBack,
    pickOutputDirectory,
    start,
    cancel,
    revealOutput,
    reset,
  }), [
    applyBatchTrim,
    batchTrimEnd,
    batchTrimStart,
    buildPlan,
    busy,
    canArrange,
    cancel,
    clearManualOrder,
    goBack,
    goNext,
    hasMixedMedia,
    imageSettings,
    importFromSearch,
    items,
    kind,
    moveItem,
    moveItemTo,
    orderRule,
    orderProfile,
    reorderOrderCriteria,
    outputDirectory,
    outputName,
    pickOutputDirectory,
    plan,
    progress,
    reset,
    resetItemTrim,
    updateItemAudio,
    updateImageClip,
    revealOutput,
    running,
    selectFiles,
    selectedItem,
    setBatchTrimEnd,
    setBatchTrimStart,
    setImageSettings,
    setOrderRule,
    setOrderCriteria,
    setOutputDirectory,
    setOutputName,
    setSelectedItemId,
    setVideoSettings,
    start,
    step,
    updateItemTrim,
    updateItemAudio,
    videoSettings,
  ])
}

export type MediaMergeController = ReturnType<typeof useMediaMerge>

function finiteSetting(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}
