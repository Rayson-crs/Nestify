import { readFileSync, writeFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function write(path, text) {
  writeFileSync(path, text.replaceAll("\r\n", "\n"));
  console.log("wrote", path);
}

function patch(path, replacements) {
  let text = read(path);
  for (const [from, to] of replacements) {
    if (!text.includes(from)) {
      throw new Error(`missing in ${path}:\n${from.slice(0, 180)}`);
    }
    text = text.replace(from, to);
  }
  write(path, text);
}

patch("apps/desktop/electron/preload.ts", [
  [
    `  clipboardWriteText: (input: { text: string }) => ipcRenderer.invoke('clipboard.writeText', input),`,
    `  clipboardWriteText: (input: { text: string }) => ipcRenderer.invoke('clipboard.writeText', input),
  logEvent: (event: string, details?: unknown) => ipcRenderer.invoke('log.event', { event, details }),`,
  ],
]);

patch("apps/desktop/electron/ipc.ts", [
  [
    `import { getRuntime } from './runtime-host'`,
    `import { logStartup } from './log'
import { getRuntime } from './runtime-host'`,
  ],
  [
    `function registerWindowIpc(): void {
  ipcMain.handle('window.minimize-to-tray', () => {
    minimizeToTray()
    return { ok: true as const }
  })

  ipcMain.handle('window.quit', () => {
    appState.quitting = true
    app.quit()
    return { ok: true as const }
  })
}`,
    `function registerWindowIpc(): void {
  ipcMain.handle('window.minimize-to-tray', () => {
    minimizeToTray()
    return { ok: true as const }
  })

  ipcMain.handle('window.quit', () => {
    appState.quitting = true
    app.quit()
    return { ok: true as const }
  })

  ipcMain.handle('log.event', (_event, input: { event?: string; details?: unknown }) => {
    const event = input.event?.trim() || 'renderer.event'
    logStartup(event, input.details)
    return { ok: true as const }
  })
}`,
  ],
]);

let ipcLib = read("apps/desktop/src/lib/ipc.ts");
if (ipcLib.includes("import type { JobOpRecord, JobRecord } from '@nestify/shared'\n")) {
  ipcLib = ipcLib.replace("import type { JobOpRecord, JobRecord } from '@nestify/shared'\n", "");
}
if (!ipcLib.includes("import type { JobOpRecord, JobRecord } from '@nestify/shared'")) {
  ipcLib = "import type { JobOpRecord, JobRecord } from '@nestify/shared'\n\n" + ipcLib;
}
if (!ipcLib.includes("logEvent?")) {
  ipcLib = ipcLib.replace(
    "  clipboardWriteText(input: { text: string }): Promise<{ ok: true }>\n",
    "  clipboardWriteText(input: { text: string }): Promise<{ ok: true }>\n  logEvent?(event: string, details?: unknown): Promise<{ ok: true }>\n",
  );
}
write("apps/desktop/src/lib/ipc.ts", ipcLib);

patch("packages/core/src/app/runtime-rules.ts", [
  [
    `import {
  createRuleSetRecord,
  deleteRuleSetRecord,
  getRuleSetRecord,
  listEntries,
  listRuleSetRecords,
  parseRuleSetYaml,
  serializeRuleSet,
  setRuleSetEnabled,
  setRuleSetPriority,
  updateRuleSetRecord,
  type RuleSetCreateInput,
  type RuleSetPatch,
  type RuleSetRecord,
} from "../db/repos/index.ts";
import { getLibrary } from "../db/repos/index.ts";`,
    `import {
  createRuleSetRecord,
  deleteRuleSetRecord,
  getLibrary,
  getRuleSetRecord,
  listEntries,
  listRuleSetRecords,
  parseRuleSetYaml,
  serializeRuleSet,
  setRuleSetEnabled,
  setRuleSetPriority,
  updateRuleSetRecord,
  type RuleSetCreateInput,
  type RuleSetPatch,
  type RuleSetRecord,
} from "../db/repos/index.ts";`,
  ],
]);

console.log("ipc patches done");
