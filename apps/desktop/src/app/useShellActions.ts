import { useCallback } from 'react'
import { callNestify, type SearchHit } from '@/lib/ipc'
import { errorMessage } from '@/lib/labels'

type BusySetter = (busy: string | null) => void
type ClosePromptSetter = (open: boolean) => void
type ErrorSetter = (error: string | null) => void
type NoticeSetter = (notice: string | null) => void
type SpotlightClose = (open: boolean, source?: string) => void

export function useShellActions({
  setBusy,
  setClosePromptOpen,
  setError,
  setNotice,
  closeSpotlight,
}: {
  setBusy: BusySetter
  setClosePromptOpen: ClosePromptSetter
  setError: ErrorSetter
  setNotice: NoticeSetter
  closeSpotlight: SpotlightClose
}) {
  const handleOpen = useCallback(async (path: string) => {
    setBusy('open')
    setError(null)
    try {
      await callNestify((api) => api.shellOpen({ path }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }, [setBusy, setError])

  const handleCopyPath = useCallback(async (path: string) => {
    setBusy('copy')
    setError(null)
    try {
      await callNestify((api) => api.clipboardWriteText({ text: path }))
      setNotice('已复制完整路径')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }, [setBusy, setError, setNotice])

  const handleMinimizeToTray = useCallback(async () => {
    setClosePromptOpen(false)
    closeSpotlight(false, 'minimize')
    try {
      await callNestify((api) =>
        api.minimizeToTray
          ? api.minimizeToTray()
          : Promise.reject(new Error('window.minimize-to-tray is unavailable')),
      )
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [closeSpotlight, setClosePromptOpen, setError])

  const handleQuitApp = useCallback(async () => {
    setClosePromptOpen(false)
    closeSpotlight(false, 'quit')
    try {
      await callNestify((api) =>
        api.quitApp ? api.quitApp() : Promise.reject(new Error('window.quit is unavailable')),
      )
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [closeSpotlight, setClosePromptOpen, setError])

  const openSpotlightHit = useCallback((hit: SearchHit) => {
    closeSpotlight(false, 'open-hit')
    void handleOpen(hit.path)
  }, [closeSpotlight, handleOpen])

  return {
    handleOpen,
    handleCopyPath,
    handleMinimizeToTray,
    handleQuitApp,
    openSpotlightHit,
  }
}
