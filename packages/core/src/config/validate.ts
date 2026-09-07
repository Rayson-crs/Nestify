export class ConfigError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ConfigError";
    this.path = path;
  }
}

const HASH = new Set(["off", "on-demand", "duplicate-candidate-only", "all"]);
const TRASH = new Set(["recycle-then-quarantine", "quarantine-only", "recycle-only"]);
const THEME = new Set(["dark", "light", "system"]);
const COLLISION = new Set(["suffix", "skip", "overwrite", "abort"]);
const FORMAT = new Set(["webp", "jpeg"]);

function assertEnum(path: string, value: unknown, allowed: Set<string>): void {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new ConfigError(path, `invalid value ${String(value)}`);
  }
}

export function validateAppConfig(input: unknown): void {
  if (!input || typeof input !== "object") {
    throw new ConfigError("$", "config must be an object");
  }
  const cfg = input as Record<string, any>;
  if (cfg.scan) assertEnum("scan.defaultHashStrategy", cfg.scan.defaultHashStrategy, HASH);
  if (cfg.trash) assertEnum("trash.strategy", cfg.trash.strategy, TRASH);
  if (cfg.theme) assertEnum("theme", cfg.theme, THEME);
  if (cfg.collision) assertEnum("collision.default", cfg.collision.default, COLLISION);
  if (cfg.preview?.format) assertEnum("preview.format", cfg.preview.format, FORMAT);
  if (cfg.search && (typeof cfg.search.debounceMs !== "number" || cfg.search.debounceMs < 0)) {
    throw new ConfigError("search.debounceMs", "must be a non-negative number");
  }
}
