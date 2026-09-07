import path from 'node:path';

export interface AppPaths {
  root: string;
  configDir: string;
  dbPath: string;
  logsDir: string;
  cacheDir: string;
  thumbnailsDir: string;
  quarantineDir: string;
  rulesDir: string;
  tmpDir: string;
}

/**
 * Join Nestify directories under `appDataRoot`.
 *
 * Default `appDataRoot` on Windows is `%APPDATA%/Nestify`.
 * This helper only joins the given root; it does not import Electron.
 */
export function resolveAppPaths(appDataRoot: string): AppPaths {
  const root = path.join(appDataRoot);
  return {
    root,
    configDir: path.join(root, 'config'),
    dbPath: path.join(root, 'nestify.sqlite'),
    logsDir: path.join(root, 'logs'),
    cacheDir: path.join(root, 'cache'),
    thumbnailsDir: path.join(root, 'cache', 'thumbnails'),
    quarantineDir: path.join(root, 'quarantine'),
    rulesDir: path.join(root, 'rules'),
    tmpDir: path.join(root, 'tmp'),
  };
}
