import { dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { getRuntime } from './runtime-host'
import { appState } from './state'
import { type RuntimeRuleSetCreate, type RuntimeRuleSetPatch, toRuleSetPayload } from './payloads'

export function registerRulesIpc(): void {
  ipcMain.handle('rules.list', async () => ({
    ruleSets: getRuntime().listRuleSets().map(toRuleSetPayload),
  }))
  ipcMain.handle('rules.get', async (_event, input: { id: string }) => {
    const ruleSet = getRuntime().getRuleSet(input.id)
    if (!ruleSet) throw new Error(`ruleset not found: ${input.id}`)
    return { ruleSet: toRuleSetPayload(ruleSet) }
  })
  ipcMain.handle('rules.create', async (_event, input: RuntimeRuleSetCreate) => ({
    ruleSet: toRuleSetPayload(getRuntime().createRuleSet(input)),
  }))
  ipcMain.handle('rules.update', async (_event, input: { id: string; patch: RuntimeRuleSetPatch }) => ({
    ruleSet: toRuleSetPayload(getRuntime().updateRuleSet(input.id, input.patch)),
  }))
  ipcMain.handle('rules.delete', async (_event, input: { id: string }) => {
    getRuntime().deleteRuleSet(input.id)
    return { ok: true as const }
  })
  ipcMain.handle('rules.enable', async (_event, input: { id: string; enabled: boolean }) => ({
    ruleSet: toRuleSetPayload(getRuntime().setRuleSetEnabled(input.id, input.enabled)),
  }))
  ipcMain.handle('rules.priority', async (_event, input: { id: string; priority: number }) => ({
    ruleSet: toRuleSetPayload(getRuntime().setRuleSetPriority(input.id, input.priority)),
  }))
  ipcMain.handle(
    'rules.clone',
    async (_event, input: { sourceId: string; name?: string; priority?: number; enabled?: boolean }) => ({
      ruleSet: toRuleSetPayload(getRuntime().cloneRuleSet(input.sourceId, input)),
    }),
  )
  ipcMain.handle('rules.export', async (_event, input: { id: string }) => {
    const yaml = getRuntime().exportRuleSet(input.id)
    const parent = focusMainWindow()
    const result = await dialog.showSaveDialog(parent, {
      title: '导出规则集',
      defaultPath: `${getRuntime().getRuleSet(input.id)?.name ?? 'ruleset'}.yaml`,
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
    })
    if (result.canceled || !result.filePath) return { yaml, path: null }
    await writeFile(result.filePath, yaml, 'utf8')
    return { yaml, path: result.filePath }
  })
  ipcMain.handle('rules.import', async () => {
    const parent = focusMainWindow()
    const result = await dialog.showOpenDialog(parent, {
      title: '导入规则集',
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    const yaml = await readFile(path, 'utf8')
    return { ruleSet: toRuleSetPayload(getRuntime().importRuleSet(yaml)) }
  })
}

function focusMainWindow() {
  const parent = appState.mainWindow
  if (parent && !parent.isDestroyed()) {
    if (parent.isMinimized()) parent.restore()
    parent.show()
    parent.focus()
  }
  return parent ?? undefined
}
