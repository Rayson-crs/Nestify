import { useCallback, useEffect, useState } from 'react'
import { callNestify, getNestifyApi, type SearchHit } from '@/lib/ipc'
import { errorMessage } from '@/lib/labels'
import type { FileOperationProgress, FileOperationRequest } from '@/app/types'

type NoticeSetter = (notice: string | null) => void
type ErrorSetter = (error: string | null) => void

const OPERATION_LABEL: Record<FileOperationProgress['operation'], string> = {
  rename: '重命名',
  move: '移动',
  delete: '删除',
}

export function useFileOperations({
  setError,
  setNotice,
  refreshFileViews,
}: {
  setError: ErrorSetter
  setNotice: NoticeSetter
  refreshFileViews: () => Promise<void>
}) {
  const [fileOperation, setFileOperation] = useState<FileOperationRequest | null>(null)
  const [fileOperationBusy, setFileOperationBusy] = useState(false)
  const [fileOperationProgress, setFileOperationProgress] = useState<FileOperationProgress | null>(null)

  useEffect(() => {
    if (fileOperationProgress?.status !== 'completed' && fileOperationProgress?.status !== 'failed') return
    const current = fileOperationProgress
    const timer = window.setTimeout(() => {
      setFileOperationProgress((latest) => latest === current ? null : latest)
    }, 1_500)
    return () => window.clearTimeout(timer)
  }, [fileOperationProgress])

  useEffect(() => {
    const api = getNestifyApi()
    if (!api?.onFileOperationProgress) return
    return api.onFileOperationProgress((progress) => {
      setFileOperationProgress((current) =>
        !current || current.requestId === progress.requestId ? progress : current,
      )
    })
  }, [])

  const handleFileRename = useCallback((hit: SearchHit) => {
    setFileOperation({ kind: 'rename', hit })
  }, [])

  const handleFileMove = useCallback((hit: SearchHit) => {
    setFileOperation({ kind: 'move', hit })
  }, [])

  const handleFileDelete = useCallback((hit: SearchHit) => {
    setFileOperation({ kind: 'delete', hit })
  }, [])

  const submitFileOperation = useCallback(async (input: {
    kind: 'rename' | 'move' | 'delete'
    hit: SearchHit
    name?: string
    directory?: string
  }) => {
    setFileOperationBusy(true)
    setError(null)
    const requestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `file-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setFileOperationProgress({
      requestId,
      operation: input.kind,
      path: input.hit.path,
      status: 'running',
      stage: `${OPERATION_LABEL[input.kind]}中`,
      percent: 0,
    })
    try {
      await callNestify((api) => {
        if (input.kind === 'rename') {
          return api.fileRename
            ? api.fileRename({
              libraryId: input.hit.libraryId,
              path: input.hit.path,
              name: input.name?.trim() ?? '',
              requestId,
            })
            : Promise.reject(new Error('file.rename is unavailable'))
        }
        if (input.kind === 'move') {
          return api.fileMove
            ? api.fileMove({
              libraryId: input.hit.libraryId,
              path: input.hit.path,
              directory: input.directory?.trim() ?? '',
              requestId,
            })
            : Promise.reject(new Error('file.move is unavailable'))
        }
        return api.fileDelete
          ? api.fileDelete({ libraryId: input.hit.libraryId, path: input.hit.path, requestId })
          : Promise.reject(new Error('file.delete is unavailable'))
      })
      setFileOperation(null)
      setNotice(input.kind === 'rename' ? '已重命名' : input.kind === 'move' ? '已移动文件' : '已删除')
      await refreshFileViews()
      setFileOperationProgress((current) =>
        current?.requestId === requestId
          ? { ...current, status: 'completed', stage: `${OPERATION_LABEL[input.kind]}完成`, percent: 100 }
          : current,
      )
    } catch (err) {
      setError(errorMessage(err))
      setFileOperationProgress((current) =>
        current?.requestId === requestId
          ? {
            ...current,
            status: 'failed',
            stage: `${OPERATION_LABEL[input.kind]}失败`,
            percent: 100,
            error: errorMessage(err),
          }
          : current,
      )
    } finally {
      setFileOperationBusy(false)
    }
  }, [refreshFileViews, setError, setNotice])

  const pickFileOperationDirectory = useCallback(async () => {
    try {
      const picked = await callNestify((api) => api.pickDirectory())
      return picked?.path ?? null
    } catch (err) {
      setError(errorMessage(err))
      return null
    }
  }, [setError])

  return {
    fileOperation,
    setFileOperation,
    fileOperationBusy,
    fileOperationProgress,
    handleFileRename,
    handleFileMove,
    handleFileDelete,
    submitFileOperation,
    pickFileOperationDirectory,
  }
}
