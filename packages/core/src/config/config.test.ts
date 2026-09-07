import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import test from "node:test";
import { loadAppConfig } from "./load.ts";
import { ConfigError, validateAppConfig } from "./validate.ts";
import { resolveAppPaths } from "../layout/directories.ts";

const bundledConfigDir = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../config");

test("default yaml loads", () => {
  const cfg = loadAppConfig({
    appDataRoot: join(tmpdir(), "nestify-missing-user-config"),
    bundledConfigDir,
    platform: "linux",
  });
  assert.equal(cfg.schemaVersion, 1);
  assert.equal(cfg.theme, "dark");
  assert.equal(cfg.search.debounceMs, 300);
  assert.equal(cfg.scan.defaultHashStrategy, "duplicate-candidate-only");
  assert.equal(cfg.safety.dryRunDefault, true);
});

test("user override deep-merges debounceMs", () => {
  const root = mkdtempSync(join(tmpdir(), "nestify-cfg-"));
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config", "app.yaml"), "search:\n  debounceMs: 120\n", "utf8");
  const cfg = loadAppConfig({ appDataRoot: root, bundledConfigDir, platform: "linux" });
  assert.equal(cfg.search.debounceMs, 120);
  assert.equal(cfg.search.limit, 200);
});

test("platform overlay applies before user config", () => {
  const bundled = mkdtempSync(join(tmpdir(), "nestify-bundled-"));
  writeFileSync(
    join(bundled, "app.default.yaml"),
    [
      "schemaVersion: 1",
      "theme: dark",
      "search:",
      "  debounceMs: 300",
      "  limit: 200",
      "scan:",
      "  defaultHashStrategy: duplicate-candidate-only",
      "safety:",
      "  dryRunDefault: true",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(join(bundled, "windows.yaml"), "search:\n  debounceMs: 50\n", "utf8");
  const root = mkdtempSync(join(tmpdir(), "nestify-user-"));
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config", "app.yaml"), "search:\n  debounceMs: 80\n", "utf8");
  const cfg = loadAppConfig({ appDataRoot: root, bundledConfigDir: bundled, platform: "win32" });
  assert.equal(cfg.search.debounceMs, 80);
  assert.equal(cfg.search.limit, 200);
});

test("invalid hash strategy throws", () => {
  assert.throws(
    () => validateAppConfig({ scan: { defaultHashStrategy: "always" } }),
    ConfigError,
  );
});

test("resolveAppPaths joins db/thumbnail/quarantine", () => {
  const paths = resolveAppPaths("C:/Users/demo/AppData/Roaming/Nestify");
  assert.equal(paths.dbPath.replaceAll("\\", "/"), "C:/Users/demo/AppData/Roaming/Nestify/nestify.sqlite");
  assert.equal(paths.thumbnailsDir.replaceAll("\\", "/"), "C:/Users/demo/AppData/Roaming/Nestify/cache/thumbnails");
  assert.equal(paths.quarantineDir.replaceAll("\\", "/"), "C:/Users/demo/AppData/Roaming/Nestify/quarantine");
});
