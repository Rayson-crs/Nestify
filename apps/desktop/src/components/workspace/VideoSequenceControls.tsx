import { Maximize2, Minimize2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatDuration } from './merge-pane-shared'
import { PLAYBACK_RATES } from './video-sequence'

export function VideoSequenceControls({
  playing,
  muted,
  disabled,
  playhead,
  total,
  scope,
  rate,
  canStep,
  showTransport = true,
  onToggle,
  onMuted,
  onScope,
  onRate,
  onScrubStart,
  onSeek,
  onScrubEnd,
  onStep,
  scalePercent,
  onScale,
  fullscreen = false,
  onFullscreen,
}: {
  playing: boolean
  muted: boolean
  disabled: boolean
  playhead: number
  total: number
  scope: 'sequence' | 'clip'
  rate: number
  canStep: boolean
  showTransport?: boolean
  onToggle: () => void
  onMuted: (muted: boolean) => void
  onScope: (scope: 'sequence' | 'clip') => void
  onRate: (rate: number) => void
  onScrubStart: () => void
  onSeek: (time: number) => void
  onScrubEnd: () => void
  onStep: (direction: -1 | 1) => void
  scalePercent?: number
  onScale?: (scalePercent: number) => void
  fullscreen?: boolean
  onFullscreen?: () => void
}) {
  const controlClass = fullscreen
    ? 'border-white/25 bg-white/10 text-white shadow-none hover:bg-white/20 hover:text-white'
    : undefined
  const secondaryTextClass = fullscreen ? 'text-white/75' : 'text-muted-foreground'
  const fullscreenContainer = fullscreen ? document.fullscreenElement : null
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {showTransport ? (
          <Button className={controlClass} variant="outline" size="icon" title="上一段" aria-label="上一段" disabled={disabled || !canStep} onClick={() => onStep(-1)}>
            <SkipBack className="h-4 w-4" />
          </Button>
        ) : null}
        <Button className={controlClass} variant="outline" size="icon" title={playing ? '暂停' : '播放'} aria-label={playing ? '暂停' : '播放'} disabled={disabled} onClick={onToggle}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        {showTransport ? (
          <Button className={controlClass} variant="outline" size="icon" title="下一段" aria-label="下一段" disabled={disabled || !canStep} onClick={() => onStep(1)}>
            <SkipForward className="h-4 w-4" />
          </Button>
        ) : null}
        <Button
          className={controlClass}
          variant="outline"
          size="icon"
          title={muted ? '打开声音' : '静音'}
          aria-label={muted ? '打开声音' : '静音'}
          aria-pressed={muted}
          disabled={disabled}
          onClick={() => onMuted(!muted)}
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </Button>
        {onScale && scalePercent != null ? (
          <>
            <Button className={controlClass} variant="outline" size="icon" title="缩小画面" aria-label="缩小画面" disabled={disabled || scalePercent <= 25} onClick={() => onScale(Math.max(25, scalePercent - 10))}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className={cn('w-12 text-center font-mono text-xs', secondaryTextClass)}>{scalePercent}%</span>
            <Button className={controlClass} variant="outline" size="icon" title="放大画面" aria-label="放大画面" disabled={disabled || scalePercent >= 300} onClick={() => onScale(Math.min(300, scalePercent + 10))}>
              <ZoomIn className="h-4 w-4" />
            </Button>
          </>
        ) : null}
        {onFullscreen ? (
          <Button className={controlClass} variant="outline" size="icon" title={fullscreen ? '退出全屏' : '全屏播放'} aria-label={fullscreen ? '退出全屏' : '全屏播放'} onClick={onFullscreen}>
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        ) : null}
        {showTransport ? (
          <div className={cn('flex h-8 overflow-hidden rounded-md border', fullscreen && 'border-white/25')}>
            <ScopeButton active={scope === 'sequence'} fullscreen={fullscreen} label="整段" onClick={() => onScope('sequence')} />
            <ScopeButton active={scope === 'clip'} fullscreen={fullscreen} label="当前片段" onClick={() => onScope('clip')} />
          </div>
        ) : null}
        <div className="ml-auto w-28">
          <Select value={String(rate)} onValueChange={(value) => onRate(Number(value))}>
            <SelectTrigger className={cn('h-8', fullscreen && 'border-white/25 bg-white/10 text-white shadow-none')} aria-label="播放倍速">
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              portalContainer={fullscreenContainer}
              className={fullscreen ? 'border-white/20 bg-zinc-950 text-white' : undefined}
            >
              {PLAYBACK_RATES.map((value) => (
                <SelectItem className={fullscreen ? 'focus:bg-white/15 focus:text-white' : undefined} key={value} value={String(value)}>{value}x</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <input
          aria-label="播放进度"
          className="h-2 min-w-0 cursor-pointer accent-primary"
          type="range"
          min={0}
          max={Math.max(total, 0.1)}
          step={0.1}
          value={Math.min(playhead, total)}
          disabled={disabled || total <= 0}
          onPointerDown={onScrubStart}
          onChange={(event) => onSeek(Number(event.target.value))}
          onPointerUp={onScrubEnd}
          onKeyUp={onScrubEnd}
          onBlur={onScrubEnd}
        />
        <span className={cn('whitespace-nowrap text-right font-mono text-xs tabular-nums', secondaryTextClass)}>
          {formatDuration(playhead)} / {formatDuration(total)}
        </span>
      </div>
    </div>
  )
}

function ScopeButton({ active, fullscreen, label, onClick }: { active: boolean; fullscreen: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        'h-8 px-3 text-xs',
        active
          ? 'bg-primary text-primary-foreground'
          : fullscreen
            ? 'bg-white/10 text-white hover:bg-white/20'
            : 'bg-background hover:bg-muted',
      )}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
