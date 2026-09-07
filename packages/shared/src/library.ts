import type { LibraryId } from './ids.ts';
import type { StorageProtocol } from './entry.ts';

export const HASH_STRATEGIES = [
  'off',
  'on-demand',
  'duplicate-candidate-only',
  'all',
] as const;
export type HashStrategy = (typeof HASH_STRATEGIES)[number];

export const MEDIA_STRATEGIES = ['off', 'standard', 'deep'] as const;
export type MediaStrategy = (typeof MEDIA_STRATEGIES)[number];

export const PREVIEW_STRATEGIES = ['off', 'standard', 'on-demand', 'visible', 'eager'] as const;
export type PreviewStrategy = (typeof PREVIEW_STRATEGIES)[number];

export interface Library {
  id: LibraryId;
  name: string;
  roots: string[];
  excludeGlobs: string[];
  maxDepth: number | null;
  followSymlinks: boolean;
  scanHidden: boolean;
  hashStrategy: HashStrategy;
  mediaStrategy: MediaStrategy;
  previewStrategy: PreviewStrategy;
  createdAt: number;
  updatedAt: number;
}

export interface LibraryPatch {
  name?: string;
  roots?: string[];
  excludeGlobs?: string[];
  maxDepth?: number | null;
  followSymlinks?: boolean;
  scanHidden?: boolean;
  hashStrategy?: HashStrategy;
  mediaStrategy?: MediaStrategy;
  previewStrategy?: PreviewStrategy;
}

export interface LibraryCreateInput {
  id?: string;
  name: string;
  roots: string[];
  excludeGlobs?: string[];
  maxDepth?: number | null;
  followSymlinks?: boolean;
  scanHidden?: boolean;
  hashStrategy?: HashStrategy;
  mediaStrategy?: MediaStrategy;
  previewStrategy?: PreviewStrategy;
  protocolHint?: StorageProtocol;
}
