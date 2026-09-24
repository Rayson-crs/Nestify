import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ExternalLink, Film, Info, Keyboard, RotateCcw, Save, Settings, SlidersHorizontal } from 'lucide-react'
import { FfmpegDirectorySetting } from '@/components/app/FfmpegDirectorySetting'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { callNestify, type NestifySettings } from '@/lib/ipc'
import nestifyLogo from '../../../resources/nestify-icon.png'

const APP_NAME = 'Nestify'
const APP_AUTHOR = 'Rayson'
const GITEE_URL = 'https://gitee.com/rayson_code'
const GITHUB_URL = 'https://github.com/Rayson-crs'

const DEFAULT_SETTINGS: NestifySettings = {
  scanConcurrency: 4,
  thumbnailConcurrency: 4,
  searchDebounceMs: 300,
  spotlightShortcut: 'Control+Space',
  minimizeToTrayOnClose: true,
  ffmpegDirectory: null,
}

const NAMED_KEYS = new Set([
  'Space', 'Tab', 'CapsLock', 'Numlock', 'ScrollLock', 'Pause', 'PrintScreen',
  'Plus', 'Minus', 'Equal', 'Comma', 'Period', 'Slash', 'Backquote',
  'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Escape',
])

function eventKey(event: KeyboardEvent): string | null {
  if (event.key === ' ') return 'Space'
  if (event.key.length === 1) return event.key.toUpperCase()
  const normalized = event.key.charAt(0).toUpperCase() + event.key.slice(1)
  if (NAMED_KEYS.has(normalized) || /^F([1-9]|1[0-9]|2[0-4])$/.test(normalized)) return normalized
  return null
}

function formatAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => part === 'Control' ? 'Ctrl' : part === 'Meta' ? 'Win' : part)
    .join(' + ')
}

function ShortcutRecorder({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const [hint, setHint] = useState('点击输入框后按下快捷键')

  const record = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      setHint('已取消录入，点击输入框后重新按下快捷键')
      return
    }

    const key = eventKey(event)
    if (!key) {
      setHint('不支持的按键，请使用字母、数字、F1-F24 或常用功能键')
      return
    }
    if (!event.ctrlKey && !event.altKey && !event.metaKey) {
      setHint('快捷键需要包含 Ctrl、Alt 或 Win')
      return
    }

    const modifiers = [
      event.ctrlKey ? 'Control' : null,
      event.altKey ? 'Alt' : null,
      event.shiftKey ? 'Shift' : null,
      event.metaKey ? 'Meta' : null,
    ].filter(Boolean)
    const next = [...modifiers, key].join('+')
    onChange(next)
    setHint(`已录入：${formatAccelerator(next)}`)
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="spotlight-shortcut">Spotlight 快捷键</Label>
      <div className="flex gap-2">
        <Input
          id="spotlight-shortcut"
          readOnly
          disabled={disabled}
          value={formatAccelerator(value)}
          onKeyDown={record}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          title="恢复默认快捷键"
          disabled={disabled}
          onClick={() => {
            onChange(DEFAULT_SETTINGS.spotlightShortcut)
            setHint('已恢复默认快捷键')
          }}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  )
}

export function SettingsDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved: (message: string) => void }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('general')
  const [version, setVersion] = useState(__APP_VERSION__)

  useEffect(() => {
    if (!open) return
    setTab('general')
    setLoading(true)
    void callNestify((api) => api.settingsGet?.() ?? Promise.resolve(DEFAULT_SETTINGS))
      .then(setSettings)
      .finally(() => setLoading(false))
    void callNestify((api) => api.appInfo?.() ?? Promise.resolve({ name: APP_NAME, version: __APP_VERSION__ }))
      .then((info) => setVersion(info.version?.trim() || __APP_VERSION__))
      .catch(() => setVersion(__APP_VERSION__))
  }, [open])

  const openExternal = (url: string) => {
    void callNestify((api) => api.shellOpenExternal?.({ url }) ?? Promise.resolve({ ok: true as const }))
      .catch(() => onSaved('无法打开外部链接'))
  }

  const save = async () => {
    setSaving(true)
    try {
      const next = await callNestify((api) => api.settingsUpdate?.(settings) ?? Promise.resolve(settings))
      setSettings(next)
      window.localStorage.setItem('nestify.settings', JSON.stringify(next))
      window.dispatchEvent(new CustomEvent('nestify:settings-updated', { detail: next }))
      onSaved('设置已保存；线程配置将在下次启动时生效')
      onOpenChange(false)
    } catch {
      onSaved('设置保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Settings className="h-4 w-4" />Nestify 设置</DialogTitle>
          <DialogDescription>
            {tab === 'about'
              ? '查看 Nestify 的版本与项目信息。'
              : tab === 'ffmpeg'
                ? '默认使用软件内置的 FFmpeg。选择自定义目录后，点「使用内置」再保存即可还原。'
                : '配置搜索、预览和快捷搜索行为。线程数会在下次启动时应用。'}
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="general"><Settings className="h-4 w-4" />常规</TabsTrigger>
            <TabsTrigger value="ffmpeg"><Film className="h-4 w-4" />FFmpeg</TabsTrigger>
            <TabsTrigger value="about"><Info className="h-4 w-4" />关于</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="grid max-h-[min(68vh,640px)] gap-5 overflow-y-auto py-2 pr-1">
            <section className="grid gap-3">
              <div className="flex items-center gap-2 text-sm font-medium"><SlidersHorizontal className="h-4 w-4" />运行并发</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5"><Label htmlFor="scan-concurrency">扫描线程</Label><Input id="scan-concurrency" type="number" min={1} max={32} disabled={loading} value={settings.scanConcurrency} onChange={(event) => setSettings({ ...settings, scanConcurrency: Number(event.target.value) || 1 })} /></div>
                <div className="grid gap-1.5"><Label htmlFor="thumbnail-concurrency">缩略图线程</Label><Input id="thumbnail-concurrency" type="number" min={1} max={32} disabled={loading} value={settings.thumbnailConcurrency} onChange={(event) => setSettings({ ...settings, thumbnailConcurrency: Number(event.target.value) || 1 })} /></div>
              </div>
            </section>
            <section className="grid gap-3">
              <div className="flex items-center gap-2 text-sm font-medium"><Keyboard className="h-4 w-4" />快捷搜索</div>
              <ShortcutRecorder
                value={settings.spotlightShortcut}
                onChange={(value) => setSettings({ ...settings, spotlightShortcut: value })}
                disabled={loading}
              />
              <div className="grid gap-1.5"><Label htmlFor="search-debounce">搜索延迟（毫秒）</Label><Input id="search-debounce" type="number" min={0} max={2000} step={50} value={settings.searchDebounceMs} onChange={(event) => setSettings({ ...settings, searchDebounceMs: Number(event.target.value) || 0 })} /></div>
            </section>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={settings.minimizeToTrayOnClose} onCheckedChange={(checked) => setSettings({ ...settings, minimizeToTrayOnClose: checked })} /><span>关闭窗口时默认最小化到托盘</span></label>
          </TabsContent>
          <TabsContent value="ffmpeg" className="py-2">
            <FfmpegDirectorySetting
              directory={settings.ffmpegDirectory}
              disabled={loading}
              onChange={(ffmpegDirectory) => setSettings({ ...settings, ffmpegDirectory })}
            />
          </TabsContent>
          <TabsContent value="about" className="py-2">
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <img src={nestifyLogo} alt="Nestify" className="h-16 w-16 rounded-[8px]" />
              <div className="grid gap-1">
                <div className="text-lg font-semibold leading-none">{APP_NAME}</div>
                <div className="text-sm text-muted-foreground">版本 {version}</div>
              </div>
              <div className="grid w-full gap-2 text-left text-sm">
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">作者</span>
                  <span>{APP_AUTHOR}</span>
                </div>
                <button type="button" className="grid gap-1 rounded-md border px-3 py-2 text-left hover:bg-accent" onClick={() => openExternal(GITEE_URL)}>
                  <span className="text-muted-foreground">Gitee</span>
                  <span className="inline-flex min-w-0 items-center gap-1 break-all text-primary">{GITEE_URL}<ExternalLink className="h-3.5 w-3.5 shrink-0" /></span>
                </button>
                <button type="button" className="grid gap-1 rounded-md border px-3 py-2 text-left hover:bg-accent" onClick={() => openExternal(GITHUB_URL)}>
                  <span className="text-muted-foreground">GitHub</span>
                  <span className="inline-flex min-w-0 items-center gap-1 break-all text-primary">{GITHUB_URL}<ExternalLink className="h-3.5 w-3.5 shrink-0" /></span>
                </button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          {tab === 'about' ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button disabled={loading || saving} onClick={() => void save()}><Save className="h-4 w-4" />{saving ? '保存中' : '保存设置'}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
