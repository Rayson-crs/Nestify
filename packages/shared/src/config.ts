import type { HashStrategy, MediaStrategy, PreviewStrategy } from './library.ts';
import type { ConflictStrategy } from './rule.ts';

export const THEMES = ['dark', 'light', 'system'] as const;
export type ThemeMode = (typeof THEMES)[number];
export type Theme = ThemeMode;

export const TRASH_STRATEGIES = [
  'recycle-then-quarantine',
  'quarantine-only',
  'recycle-only',
] as const;
export type TrashStrategy = (typeof TRASH_STRATEGIES)[number];

export const PREVIEW_FORMATS = ['webp', 'jpeg'] as const;
export type PreviewFormat = (typeof PREVIEW_FORMATS)[number];

export interface WorkerConcurrency {
  localSsd: number;
  hdd: number;
  smb: number;
}

export interface WorkerLimits {
  scanConcurrency: WorkerConcurrency;
  hashConcurrency: WorkerConcurrency;
  thumbnailConcurrency: WorkerConcurrency;
}

export interface AppConfig {
  schemaVersion: number;
  locale: string;
  theme: ThemeMode;
  search: {
    debounceMs: number;
    limit: number;
  };
  trash: {
    strategy: TrashStrategy;
  };
  scan: {
    defaultHashStrategy: HashStrategy;
    excludeGlobs: string[];
    followSymlinks: boolean;
    scanHidden: boolean;
  };
  workers: WorkerLimits;
  preview: {
    thumbnailSize: number;
    format: PreviewFormat;
    ffmpegEnabled: boolean;
  };
  collision: {
    default: ConflictStrategy;
  };
  safety: {
    dryRunDefault: boolean;
    overwriteRequiresTypedConfirm: boolean;
  };
  paths: {
    quarantineDirName: string;
    thumbnailsSubdir: string;
    dbFileName: string;
  };
}

export interface LibraryConfigDefaults {
  hashStrategy: HashStrategy | 'inherit';
  mediaStrategy: MediaStrategy | 'inherit';
  previewStrategy: PreviewStrategy | 'inherit';
  maxDepth: number | null;
  followSymlinks: boolean | 'inherit';
  scanHidden: boolean | 'inherit';
  excludeGlobs: string[] | 'inherit';
}

export interface ExclusionConfig {
  globs: string[];
  names: string[];
}

export const DEFAULT_WORKER_LIMITS: WorkerLimits = {
  scanConcurrency: { localSsd: 8, hdd: 2, smb: 1 },
  hashConcurrency: { localSsd: 4, hdd: 1, smb: 1 },
  thumbnailConcurrency: { localSsd: 4, hdd: 2, smb: 1 },
};

export const DEFAULT_APP_CONFIG: AppConfig = {
  schemaVersion: 1,
  locale: 'zh-CN',
  theme: 'dark',
  search: {
    debounceMs: 300,
    limit: 200,
  },
  trash: {
    strategy: 'recycle-then-quarantine',
  },
  scan: {
    defaultHashStrategy: 'duplicate-candidate-only',
    excludeGlobs: [
      '$RECYCLE.BIN',
      'System Volume Information',
      '.git',
      'node_modules',
      '__pycache__',
      '.nestify-quarantine',
      'Thumbs.db',
      'desktop.ini',
    ],
    followSymlinks: false,
    scanHidden: false,
  },
  workers: DEFAULT_WORKER_LIMITS,
  preview: {
    thumbnailSize: 128,
    format: 'webp',
    ffmpegEnabled: true,
  },
  collision: {
    default: 'suffix',
  },
  safety: {
    dryRunDefault: true,
    overwriteRequiresTypedConfirm: true,
  },
  paths: {
    quarantineDirName: '.nestify-quarantine',
    thumbnailsSubdir: 'cache/thumbnails',
    dbFileName: 'nestify.sqlite',
  },
};
