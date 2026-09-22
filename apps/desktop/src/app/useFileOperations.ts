import { useCallback, useState } from 'react'
import { callNestify, type SearchHit } from '@/lib/ipc'
import { errorMessage } from '@/lib/labels'
import type { FileOperationRequest } from '@/app/types'

type NoticeSetter = (notice: string | null) => void
type ErrorSetter = (error: string | null) => void

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
    try {
      await callNestify((api) => {
        if (input.kind === 'rename') {
          return api.fileRename
            ? api.fileRename({
              libraryId: input.hit.libraryId,
              path: input.hit.path,
              name: input.name?.trim() ?? '',
            })
            : Promise.reject(new Error('file.rename is unavailable'))
        }
        if (input.kind === 'move') {
          return api.fileMove
            ? api.fileMove({
              libraryId: input.hit.libraryId,
              path: input.hit.path,
              directory: input.directory?.trim() ?? '',
            })
            : Promise.reject(new Error('file.move is unavailable'))
        }
        return api.fileDelete
          ? api.fileDelete({ libraryId: input.hit.libraryId, path: input.hit.path })
          : Promise.reject(new Error('file.delete is unavailable'))
      })
      setFileOperation(null)
      setNotice(input.kind === 'rename' ? '已重命名' : input.kind === 'move' ? '已移动文件' : '已删除')
      await refreshFileViews()
    } catch (err) {
      setError(errorMessage(err))
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
    handleFileRename,
    handleFileMove,
    handleFileDelete,
    submitFileOperation,
    pickFileOperationDirectory,
  }
}
