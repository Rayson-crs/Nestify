import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ALL_LIBRARIES_ID,
  callNestify,
  getNestifyApi,
  type LibraryRemovalProgress,
  type LibrarySummary,
  type ScanProgress,
  type SearchHit,
} from '@/lib/ipc'
import { errorMessage, parentName } from '@/lib/labels'
import { isWithinDirectory } from '@/lib/path-crumbs'
import { DEFAULT_LIBRARY_DRAFT, type LibraryDraft } from '@/lib/workspace'
import type { ConfirmationRequest } from '@/app/types'

export function useLibraries(options: {
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  requestConfirmation: (request: ConfirmationRequest) => void
}) {
  const { setError, setNotice, requestConfirmation } = options
  const [ipcReady] = useState(() => Boolean(getNestifyApi()))
  const [libraries, setLibraries] = useState<LibrarySummary[]>([])
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null)
  const [editingLibraryId, setEditingLibraryId] = useState<string | null>(null)
  const [librarySourceOpen, setLibrarySourceOpen] = useState(false)
  const [libraryDraft, setLibraryDraft] = useState<LibraryDraft>(DEFAULT_LIBRARY_DRAFT)
  const [scan, setScan] = useState<ScanProgress>({
    phase: 'idle',
    filesScanned: 0,
    dirsScanned: 0,
    bytesScanned: 0,
    errors: 0,
  })
  const [scanJobId, setScanJobId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [removalProgress, setRemovalProgress] = useState<LibraryRemovalProgress | null>(null)

  const allLibrariesSelected = selectedLibraryId === ALL_LIBRARIES_ID
  const hasLibraries = libraries.length > 0
  const selectedLibrary = libraries.find((item) => item.id === selectedLibraryId) ?? null
  const editingLibrary = libraries.find((item) => item.id === editingLibraryId) ?? null
  const scanning = scan.phase === 'walk' || scan.phase === 'upsert' || Boolean(scan.paused)
  const scanPaused = Boolean(scan.paused)
  const removingLibrary = selectedLibrary
    ? busy === `remove:${selectedLibrary.id}` || removalProgress?.libraryId === selectedLibrary.id
    : Boolean(removalProgress)
  const libraryRootHits = useMemo<SearchHit[]>(
    () =>
      libraries.flatMap((library) =>
        library.roots.map((root) => ({
          entryId: `library-root:${library.id}:${root}`,
          libraryId: library.id,
          name: library.name,
          path: root,
          ext: '',
          parent: null,
          kind: 'dir',
          size: 0,
          mtime: library.updatedAt ?? null,
        })),
      ),
    [libraries],
  )

  const treeRootPathFor = useCallback(
    (treePath: string | null) => {
      const roots = allLibrariesSelected
        ? libraries.flatMap((library) => library.roots)
        : selectedLibrary?.roots ?? []
      const currentPath = treePath ?? ''
      return roots.find((root) => isWithinDirectory(currentPath, root)) ?? (allLibrariesSelected ? null : roots[0] ?? null)
    },
    [allLibrariesSelected, libraries, selectedLibrary],
  )

  const loadLibraries = useCallback(async (preferId?: string) => {
    const { libraries: next } = await callNestify((api) => api.libraryList())
    const validLibraries = next.filter((library) => Boolean(library?.id))
    setLibraries(validLibraries)
    setSelectedLibraryId((current) => {
      const preferred = preferId ?? current
      if (validLibraries.length === 0) return null
      return preferred && validLibraries.some((library) => library.id === preferred)
        ? preferred
        : ALL_LIBRARIES_ID
    })
  }, [])

  const handleRefreshLibraries = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      await loadLibraries()
      setNotice('资料库列表已刷新')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRefreshing(false)
    }
  }, [loadLibraries, setError, setNotice])

  useEffect(() => {
    if (!editingLibrary) return
    setLibraryDraft({
      name: editingLibrary.name,
      roots: editingLibrary.roots.join('\n'),
      excludeGlobs: editingLibrary.excludeGlobs.join('\n'),
      maxDepth: editingLibrary.maxDepth == null ? '' : String(editingLibrary.maxDepth),
      followSymlinks: editingLibrary.followSymlinks,
      scanHidden: editingLibrary.scanHidden,
      hashStrategy: editingLibrary.hashStrategy,
      mediaStrategy: editingLibrary.mediaStrategy,
      previewStrategy: editingLibrary.previewStrategy,
    })
  }, [editingLibrary])

  useEffect(() => {
    if (!ipcReady) return
    void callNestify((api) => api.scanProgress())
      .then((progress) => {
        setScan(progress)
        setScanJobId(progress.jobId ?? null)
        const active =
          progress.paused === true ||
          progress.jobStatus === 'running' ||
          progress.jobStatus === 'paused' ||
          progress.jobStatus === 'cancelling'
        if (active && progress.libraryId) setSelectedLibraryId(progress.libraryId)
      })
      .catch((err) => setError(errorMessage(err)))
  }, [ipcReady, setError])

  useEffect(() => {
    if (!scanning) return
    const timer = window.setInterval(() => {
      void callNestify((api) => api.scanProgress())
        .then(setScan)
        .catch((err) => setError(errorMessage(err)))
    }, 250)
    return () => window.clearInterval(timer)
  }, [scanning, setError])

  useEffect(() => {
    const api = getNestifyApi()
    if (!api?.onLibraryRemovalProgress) return
    return api.onLibraryRemovalProgress((progress) => {
      setRemovalProgress(progress)
      if (progress.status === 'running' || progress.status === 'queued') return

      setBusy((current) => (current === `remove:${progress.libraryId}` ? null : current))
      if (progress.status === 'completed') {
        void loadLibraries().catch((err) => setError(errorMessage(err)))
        setNotice(`已移除资料库 ${progress.libraryName}`)
        window.setTimeout(() => {
          setRemovalProgress((current) => (current?.jobId === progress.jobId ? null : current))
        }, 1200)
      } else {
        setError(progress.error || `移除资料库 ${progress.libraryName} 失败`)
        window.setTimeout(() => {
          setRemovalProgress((current) => (current?.jobId === progress.jobId ? null : current))
        }, 2400)
      }
    })
  }, [loadLibraries, setError, setNotice])

  const handleAddLibrary = async () => {
    setError(null)
    setLibrarySourceOpen(true)
  }

  const addLibraryFromRoots = async (name: string, roots: string[]) => {
    setBusy('add')
    setError(null)
    try {
      const normalizedRoots = [...new Set(roots.map((root) => root.trim()).filter(Boolean))]
      if (normalizedRoots.length === 0) throw new Error('没有找到可读取的磁盘')
      const { library } = await callNestify((api) => api.libraryAdd({ name, roots: normalizedRoots }))
      await loadLibraries(library.id)
      setLibrarySourceOpen(false)
      requestConfirmation({
        title: '扫描新资料库',
        description: `资料库“${library.name}”已添加，是否立即扫描？`,
        confirmLabel: '立即扫描',
        cancelLabel: '稍后扫描',
        action: async () => {
          try {
            await scanLibrariesSequentially([library.id])
            setNotice(`已完成读取 ${normalizedRoots.length} 个磁盘`)
          } catch (err) {
            setError(errorMessage(err))
          }
        },
      })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleAddCustomLibrary = async () => {
    setBusy('add')
    setError(null)
    try {
      setLibrarySourceOpen(false)
      const picked = await callNestify((api) => api.pickDirectory())
      if (!picked) {
        setNotice('已取消添加资料库')
        return
      }
      await addLibraryFromRoots(parentName(picked.path), [picked.path])
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleAddEntireComputer = async (splitByDrive = true) => {
    setBusy('add')
    setError(null)
    try {
      const { roots } = await callNestify((api) =>
        api.listDriveRoots ? api.listDriveRoots() : Promise.reject(new Error('system.list-drive-roots is unavailable')),
      )
      const existingRoots = new Set(libraries.flatMap((library) => library.roots.map((root) => root.toLowerCase())))
      const newRoots = roots.filter((root) => !existingRoots.has(root.toLowerCase()))
      if (newRoots.length === 0) {
        setLibrarySourceOpen(false)
        setNotice('所有磁盘已经存在资料库')
        return
      }
      const createdIds: string[] = []
      if (splitByDrive) {
        for (const root of newRoots) {
          const driveName = root.replace(/[\\/:]+$/, '') || root
          const { library } = await callNestify((api) => api.libraryAdd({ name: `电脑 ${driveName}`, roots: [root] }))
          createdIds.push(library.id)
        }
      } else {
        const { library } = await callNestify((api) =>
          api.libraryAdd({ name: '整台电脑', roots: newRoots }),
        )
        createdIds.push(library.id)
      }
      await loadLibraries(createdIds[0])
      setLibrarySourceOpen(false)
      requestConfirmation({
        title: '扫描新资料库',
        description: splitByDrive
          ? `已添加 ${createdIds.length} 个资料库，是否立即扫描？`
          : '资料库“整台电脑”已添加，是否立即扫描？',
        confirmLabel: '立即扫描',
        cancelLabel: '稍后扫描',
        action: async () => {
          try {
            await scanLibrariesSequentially(createdIds)
            setNotice(
              splitByDrive
                ? `已完成读取 ${createdIds.length} 个磁盘资料库`
                : '已完成读取整台电脑',
            )
          } catch (err) {
            setError(errorMessage(err))
          }
        },
      })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const scanLibrariesSequentially = async (libraryIds: string[]) => {
    for (const libraryId of libraryIds) {
      setSelectedLibraryId(libraryId)
      const started = await callNestify((api) => api.scanStart({ libraryId }))
      setScanJobId(started.job.id)
      setScan((current) => ({ ...current, phase: 'walk', jobId: started.job.id, libraryId, jobStatus: 'running', paused: false }))
      let active = true
      while (active) {
        await new Promise((resolve) => window.setTimeout(resolve, 500))
        const progress = await callNestify((api) => api.scanProgress())
        setScan(progress)
        setScanJobId(progress.jobId ?? started.job.id)
        active = progress.libraryId === libraryId && Boolean(progress.jobStatus)
      }
    }
  }

  const handleScan = async (onStarted?: (jobId: string) => Promise<void> | void) => {
    if (!selectedLibrary) return
    setBusy('scan')
    setError(null)
    try {
      const started = await callNestify((api) => api.scanStart({ libraryId: selectedLibrary.id }))
      setScanJobId(started.job.id)
      setScan((current) => ({ ...current, phase: 'walk' }))
      setNotice('扫描已开始')
      await onStarted?.(started.job.id)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const handleScanControl = async (
    action: 'pause' | 'resume' | 'cancel',
    onChanged?: () => Promise<void> | void,
  ) => {
    if (!scanJobId) return
    setBusy(`scan:${action}`)
    setError(null)
    try {
      await callNestify((api) => {
        if (action === 'pause') {
          return api.scanPause ? api.scanPause({ jobId: scanJobId }) : Promise.reject(new Error('scan.pause is unavailable'))
        }
        if (action === 'resume') {
          return api.scanResume ? api.scanResume({ jobId: scanJobId }) : Promise.reject(new Error('scan.resume is unavailable'))
        }
        return api.scanCancel ? api.scanCancel({ jobId: scanJobId }) : Promise.reject(new Error('scan.cancel is unavailable'))
      })
      setNotice(action === 'pause' ? '扫描已暂停' : action === 'resume' ? '扫描已恢复' : '正在取消扫描')
      await onChanged?.()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const performRemoveLibrary = async (libraryId: string, name: string, onRemoved?: () => Promise<void> | void) => {
    setBusy(`remove:${libraryId}`)
    setError(null)
    try {
      await callNestify((api) =>
        api.libraryRemove ? api.libraryRemove({ id: libraryId }) : Promise.reject(new Error('library.remove is unavailable')),
      )
      void Promise.resolve(onRemoved?.()).catch((err) => setError(errorMessage(err)))
      setNotice(`已开始移除资料库 ${name}，可在任务中查看进度`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(null)
    }
  }

  const handleRemoveLibrary = (libraryId: string, name: string, onRemoved?: () => Promise<void> | void) =>
    requestConfirmation({
      title: '移除资料库',
      description: `将移除 ${name} 的索引、任务和缩略图记录。源文件不会被删除。`,
      confirmLabel: '移除',
      action: () => performRemoveLibrary(libraryId, name, onRemoved),
    })

  const handleUpdateLibrary = async () => {
    if (!editingLibrary) return
    const name = libraryDraft.name.trim()
    const roots = libraryDraft.roots.split('\n').map((line) => line.trim()).filter(Boolean)
    const excludeGlobs = libraryDraft.excludeGlobs.split('\n').map((line) => line.trim()).filter(Boolean)
    const maxDepth = libraryDraft.maxDepth.trim() ? Number(libraryDraft.maxDepth) : null
    if (!name) {
      setError('资料库名称不能为空')
      return
    }
    if (roots.length === 0) {
      setError('至少保留一个根目录')
      return
    }
    if (maxDepth != null && (!Number.isInteger(maxDepth) || maxDepth < 0)) {
      setError('最大深度必须是空或非负整数')
      return
    }

    setBusy(`library:update:${editingLibrary.id}`)
    setError(null)
    try {
      const { library } = await callNestify((api) =>
        api.libraryUpdate
          ? api.libraryUpdate({
              id: editingLibrary.id,
              patch: {
                name,
                roots,
                excludeGlobs,
                maxDepth,
                followSymlinks: libraryDraft.followSymlinks,
                scanHidden: libraryDraft.scanHidden,
                hashStrategy: libraryDraft.hashStrategy,
                mediaStrategy: libraryDraft.mediaStrategy,
                previewStrategy: libraryDraft.previewStrategy,
              },
            })
          : Promise.reject(new Error('library.update is unavailable')),
      )
      await loadLibraries(library.id)
      setEditingLibraryId(null)
      setNotice(`已保存资料库 ${library.name}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return {
    ipcReady,
    libraries,
    selectedLibraryId,
    setSelectedLibraryId,
    editingLibraryId,
    setEditingLibraryId,
    librarySourceOpen,
    setLibrarySourceOpen,
    libraryDraft,
    setLibraryDraft,
    scan,
    scanJobId,
    busy,
    setBusy,
    refreshing,
    allLibrariesSelected,
    hasLibraries,
    selectedLibrary,
    scanning,
    scanPaused,
    removingLibrary,
    removalProgress,
    libraryRootHits,
    treeRootPathFor,
    loadLibraries,
    handleRefreshLibraries,
    handleAddLibrary,
    handleAddCustomLibrary,
    handleAddEntireComputer,
    handleScan,
    handleScanControl,
    handleRemoveLibrary,
    handleUpdateLibrary,
  }
}
