import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
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
  onToggle,
  onMuted,
  onScope,
  onRate,
  onScrubStart,
  onSeek,
  onScrubEnd,
  onStep,
}: {
  playing: boolean
  muted: boolean
  disabled: boolean
  playhead: number
  total: number
  scope: 'sequence' | 'clip'
  rate: number
  canStep: boolean
  onToggle: () => void
  onMuted: (muted: boolean) => void
  onScope: (scope: 'sequence' | 'clip') => void
  onRate: (rate: number) => void
  onScrubStart: () => void
  onSeek: (time: number) => void
  onScrubEnd: () => void
  onStep: (direction: -1 | 1) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" title="上一段" aria-label="上一段" disabled={disabled || !canStep} onClick={() => onStep(-1)}>
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" title={playing ? '暂停' : '播放'} aria-label={playing ? '暂停' : '播放'} disabled={disabled} onClick={onToggle}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button variant="outline" size="icon" title="下一段" aria-label="下一段" disabled={disabled || !canStep} onClick={() => onStep(1)}>
          <SkipForward className="h-4 w-4" />
        </Button>
        <Button
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
        <div className="flex h-8 overflow-hidden rounded-md border">
          <ScopeButton active={scope === 'sequence'} label="整段" onClick={() => onScope('sequence')} />
          <ScopeButton active={scope === 'clip'} label="当前片段" onClick={() => onScope('clip')} />
        </div>
        <div className="ml-auto w-28">
          <Select value={String(rate)} onValueChange={(value) => onRate(Number(value))}>
            <SelectTrigger className="h-8" aria-label="播放倍速">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAYBACK_RATES.map((value) => (
                <SelectItem key={value} value={String(value)}>{value}x</SelectItem>
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
        <span className="whitespace-nowrap text-right font-mono text-xs tabular-nums text-muted-foreground">
          {formatDuration(playhead)} / {formatDuration(total)}
        </span>
      </div>
    </div>
  )
}

function ScopeButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn('h-8 px-3 text-xs', active ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
