import { mkdirSync } from 'node:fs';
import type { AppPaths } from './directories.ts';

export function ensureAppDirs(paths: AppPaths): void {
  mkdirSync(paths.configDir, { recursive: true });
  mkdirSync(paths.logsDir, { recursive: true });
  mkdirSync(paths.cacheDir, { recursive: true });
  mkdirSync(paths.thumbnailsDir, { recursive: true });
  mkdirSync(paths.quarantineDir, { recursive: true });
  mkdirSync(paths.rulesDir, { recursive: true });
  mkdirSync(paths.tmpDir, { recursive: true });
}
