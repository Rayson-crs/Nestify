import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { AppConfig } from "@nestify/shared";
import { deepMerge } from "./merge.ts";
import { validateAppConfig } from "./validate.ts";

export interface LoadAppConfigOptions {
  appDataRoot: string;
  bundledConfigDir: string;
  platform?: NodeJS.Platform;
}

export function loadYamlFile<T>(path: string): T {
  const raw = readFileSync(path, "utf8");
  const parsed = parseYaml(raw);
  return (parsed ?? {}) as T;
}

function readOptionalYaml<T>(path: string): T | undefined {
  try {
    return loadYamlFile<T>(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

function platformOverlayName(platform: NodeJS.Platform): string | undefined {
  if (platform === "win32") return "windows.yaml";
  if (platform === "darwin") return "darwin.yaml";
  return undefined;
}

export function loadAppConfig(options: LoadAppConfigOptions): AppConfig {
  const bundled = loadYamlFile<AppConfig>(join(options.bundledConfigDir, "app.default.yaml"));
  let merged = bundled;
  const overlayName = platformOverlayName(options.platform ?? process.platform);
  if (overlayName) {
    const overlay = readOptionalYaml<Partial<AppConfig>>(join(options.bundledConfigDir, overlayName));
    if (overlay) merged = deepMerge(merged, overlay);
  }
  const user = readOptionalYaml<Partial<AppConfig>>(join(options.appDataRoot, "config", "app.yaml"));
  if (user) merged = deepMerge(merged, user);
  validateAppConfig(merged);
  return merged;
}
