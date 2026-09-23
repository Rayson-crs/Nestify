export type MediaMergeKind = 'image' | 'video'

export type MediaMergeOrderField = 'name' | 'number' | 'mtime' | 'path' | 'extension' | 'size'

export type MediaMergeOrderDirection = 'asc' | 'desc'

export type MediaMergeOrderTextMode = 'natural' | 'literal'

export interface MediaMergeOrderCriterion {
  id: string
  field: MediaMergeOrderField
  direction: MediaMergeOrderDirection
  textMode: MediaMergeOrderTextMode
  pattern: string
}

export interface MediaMergeOrderProfile {
  criteria: MediaMergeOrderCriterion[]
}

export type MediaMergeOrderRule = 'manual' | 'rules' | 'name-natural' | 'name-number' | 'mtime' | 'path'

export type MediaMergeTrimSource = 'batch' | 'custom'

export type MediaMergeImageMotion = 'still' | 'fade' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right'

export type MediaMergeFrameFit = 'contain' | 'cover'

export type MediaMergeItemRotation = 'none' | 'clockwise-90' | 'rotate-180' | 'counterclockwise-90'

export interface MediaMergeSelectedFile {
  path: string
  kind: MediaMergeKind
  size: number
  mtime: number
}

export interface MediaMergeItem {
  id: string
  path: string
  kind: MediaMergeKind
  size: number
  mtime: number | null
  trimStart: number
  trimEndOffset: number | null
  trimSource: MediaMergeTrimSource
  orderIndex: number
  manualOrder: boolean
  volume?: number
  muted?: boolean
  audioFadeInSeconds?: number
  audioFadeOutSeconds?: number
  imageDurationSeconds?: number
  imageMotion?: MediaMergeImageMotion
  imageClipSource?: MediaMergeTrimSource
  frameFit?: MediaMergeFrameFit
  frameFitSource?: MediaMergeTrimSource
  rotation?: MediaMergeItemRotation
  frameScalePercent?: number
  frameFocusX?: number
  frameFocusY?: number
}

export interface MediaMergeImageSettings {
  format: 'jpg' | 'png' | 'webp' | 'gif'
  layout?: 'vertical' | 'horizontal' | 'grid'
  width: number
  height?: number
  columns?: number
  gap: number
  background: 'white' | 'transparent'
  gifWidth?: number
  gifHeight?: number
  gifFrameDurationSeconds?: number
  gifLoopCount?: number
}

export type MediaMergeVideoFit = 'largest' | 'first' | 'limit-1080p'

export interface MediaMergeTransitionSettings {
  type: 'none' | 'crossfade'
  durationSeconds: number
}

export type MediaMergeVideoFormat = 'mp4' | 'mov' | 'mkv' | 'webm' | 'avi' | 'ts'

export interface MediaMergeVideoSettings {
  format?: MediaMergeVideoFormat
  quality: 'standard' | 'high'
  audio: 'keep' | 'mute'
  encodingMode?: 'auto' | 'reencode' | 'stream-copy'
  transition?: MediaMergeTransitionSettings
  outputVolume?: number
  fit?: MediaMergeVideoFit
  canvasWidth?: number
  canvasHeight?: number
  loudnessNormalize?: boolean
}

export interface MediaMergePlanInput {
  kind: MediaMergeKind
  items: MediaMergeItem[]
  orderRule: MediaMergeOrderRule
  orderProfile?: MediaMergeOrderProfile
  outputDirectory: string
  outputName: string
  image?: MediaMergeImageSettings
  video?: MediaMergeVideoSettings
}

export interface MediaMergeImageSummary {
  width: number
  height: number
  layout: NonNullable<MediaMergeImageSettings['layout']>
  columns: number
  gap: number
  animated?: boolean
  durationSeconds?: number
}

export interface MediaMergeVideoSummary {
  originalDurationSeconds: number
  trimmedDurationSeconds: number
  outputDurationSeconds?: number
  customTrimCount: number
  batchTrimCount: number
  width?: number
  height?: number
  streamCopy?: 'available' | 'unavailable' | 'not-requested'
  streamCopyReason?: string | null
}

export interface MediaMergePreviewProxy {
  src: string
  status: 'ready' | 'preparing' | 'failed'
  error?: string | null
}

export interface MediaMergePlan {
  version: 1
  kind: MediaMergeKind
  items: MediaMergeItem[]
  outputDirectory: string
  outputName: string
  outputPath: string
  image?: MediaMergeImageSettings
  video?: MediaMergeVideoSettings
  summary: {
    itemCount: number
    image?: MediaMergeImageSummary
    video?: MediaMergeVideoSummary
    warnings: string[]
  }
}

export interface MediaMergeProgress {
  jobId: string
  status: 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled'
  phase: 'validating' | 'analyzing' | 'preparing' | 'processing' | 'finalizing'
  percent: number
  current: number
  total: number
  outputPath: string | null
  error: string | null
  checkpoint?: MediaMergeCheckpoint | null
  resumeSupported: boolean
}

export interface MediaMergeResult {
  jobId: string
  outputPath: string
}

export interface MediaMergeCheckpoint {
  version: 1
  jobId: string
  workspacePath: string
  preferredOutputPath: string
  outputPath: string
  completedStages: string[]
  totalStages: number
  updatedAt: number
}

export interface MediaMergeWorkspaceManifest {
  version: 1
  jobId: string
  planIdentity: string
  preferredOutputPath: string
  outputPath: string
  workspacePath: string
  inputs: Array<{
    path: string
    size: number
    mtime: number | null
  }>
  completedStages: string[]
  totalStages: number
  updatedAt: number
}

export interface MediaMergeJobStats {
  kind: MediaMergeKind
  itemCount: number
  outputPath: string | null
  progress: MediaMergeProgress
  plan: MediaMergePlan
  checkpoint?: MediaMergeCheckpoint | null
}

export interface MediaMergeTimelineFrame {
  timeSeconds: number
  dataUrl: string
}

export interface MediaMergeTimeline {
  frames: MediaMergeTimelineFrame[]
  durationSeconds?: number
  error: string | null
}

export interface MediaMergeWaveform {
  peaks: number[]
  sampleRate: number
  durationSeconds: number
  error: string | null
}

export interface MediaMergeDuration {
  durationSeconds: number
  error: string | null
}
