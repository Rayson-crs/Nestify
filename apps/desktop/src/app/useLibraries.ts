import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ALL_LIBRARIES_ID,
  callNestify,
  getNestifyApi,
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

  const allLibrariesSelected = selectedLibraryId === ALL_LIBRARIES_ID
  const hasLibraries = libraries.length > 0
  const selectedLibrary = libraries.find((item) => item.id === selectedLibraryId) ?? null
  const editingLibrary = libraries.find((item) => item.id === editingLibraryId) ?? null
  const scanning = scan.phase === 'walk' || scan.phase === 'upsert' || Boolean(scan.paused)
  const scanPaused = Boolean(scan.paused)
  const removingLibrary = selectedLibrary ? busy === `remove:${selectedLibrary.id}` : false
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

  const handleAddLibrary = async () => {
    setBusy('add')
    setError(null)
    try {
      const picked = await callNestify((api) => api.pickDirectory())
      if (!picked) {
        setNotice('已取消添加资料库')
        return
      }
      const name = parentName(picked.path)
      const { library } = await callNestify((api) => api.libraryAdd({ name, roots: [picked.path] }))
      await loadLibraries(library.id)
      setNotice(`已添加资料库 ${library.name}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
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
      setNotice(`已移除资料库 ${name}`)
      await loadLibraries()
      await onRemoved?.()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
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
    libraryDraft,
    setLibraryDraft,
    scan,
    scanJobId,
    busy,
    setBusy,
    allLibrariesSelected,
    hasLibraries,
    selectedLibrary,
    scanning,
    scanPaused,
    removingLibrary,
    libraryRootHits,
    treeRootPathFor,
    loadLibraries,
    handleAddLibrary,
    handleScan,
    handleScanControl,
    handleRemoveLibrary,
    handleUpdateLibrary,
  }
}
