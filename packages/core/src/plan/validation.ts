export function isUnder(path: string, root: string): boolean {
  if (!root) return false;
  const value = normalizePathKey(path);
  const base = normalizePathKey(root);
  return value === base || value.startsWith(`${base}/`);
}

export function isUnderAny(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => isUnder(path, root));
}

export function isProtectedPath(path: string, protectedPath: string): boolean {
  const value = normalizePathKey(path);
  const base = normalizePathKey(protectedPath);
  if (!base) return false;
  if (/^[a-z]:$/.test(base) || base === "/") return value === base;
  return value === base || value.startsWith(`${base}/`);
}

export function protectedPathsFor(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === "win32") {
    return [
      env.SystemRoot,
      env.windir,
      env.ProgramFiles,
      env["ProgramFiles(x86)"],
      env.ProgramData,
      env.SYSTEMDRIVE,
    ].filter((value): value is string => Boolean(value));
  }
  return ["/", "/bin", "/etc", "/sbin", "/usr", "/var"];
}

export function normalizePathKey(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}
