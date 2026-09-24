import { useState } from 'react'
import { FolderOpen, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { callNestify } from '@/lib/ipc'

export function FfmpegDirectorySetting({
  directory,
  disabled,
  onChange,
}: {
  directory: string | null
  disabled: boolean
  onChange: (directory: string | null) => void
}) {
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState('')

  const pickDirectory = async () => {
    const picked = await callNestify((api) => api.pickDirectory())
    if (!picked?.path) return
    onChange(picked.path)
    setMessage('')
  }

  const testDirectory = async () => {
    setTesting(true)
    try {
      const result = await callNestify((api) => api.settingsTestFfmpeg?.({ directory }) ?? Promise.resolve({
        ok: false,
        message: '当前版本不支持测试 FFmpeg',
        ffmpegVersion: null,
        ffprobeVersion: null,
      }))
      setMessage(result.message)
    } catch {
      setMessage('FFmpeg 测试失败')
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
        <span className="text-muted-foreground">当前来源</span>
        <span>{directory ? '自定义目录' : '软件内置'}</span>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ffmpeg-directory">FFmpeg 目录</Label>
        <Input id="ffmpeg-directory" readOnly disabled={disabled} value={directory ?? '使用内置'} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={disabled} onClick={() => void pickDirectory()}><FolderOpen className="h-4 w-4" />选择目录</Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !directory}
            onClick={() => {
              onChange(null)
              setMessage('已切回软件内置，保存后生效')
            }}
          >
            <RotateCcw className="h-4 w-4" />使用内置
          </Button>
          <Button type="button" variant="outline" disabled={disabled || testing} onClick={() => void testDirectory()}>{testing ? '测试中' : '测试'}</Button>
        </div>
        <p className="text-sm text-muted-foreground">{message || '目录内需要同时有 ffmpeg 和 ffprobe，也可以放在 bin 子目录。测试只检查当前选择，不会保存。'}</p>
      </div>
    </section>
  )
}
