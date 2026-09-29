import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { NestifyApi } from './ipc'

type MockInvoke = (
  command: string,
  args?: Record<string, unknown>,
  options?: unknown,
) => Promise<unknown>

test('spotlight shortcut bootstrap logs failures and the host exposes registration', async () => {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  const invoke: MockInvoke = async (command, args) => {
    calls.push({ command, args })
    if (command === 'plugin:event|listen') return 1
    if (command === 'sidecar_call' && args?.method === 'sidecar.meta') {
      throw new Error('sidecar unavailable')
    }
    if (command === 'sidecar_call' && args?.method === 'log.event') return {}
    if (command === 'register_spotlight_shortcut') return null
    throw new Error(`unexpected command: ${command}`)
  }
  const mockWindow = globalThis as unknown as Window & typeof globalThis
  mockWindow.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: () => 1,
  }
  globalThis.window = mockWindow

  const errors: unknown[][] = []
  const originalError = console.error
  console.error = (...values: unknown[]) => {
    errors.push(values)
  }
  try {
    await import('./nestify-host.ts')
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(errors.length, 1)
    assert.match(String(errors[0]?.[0]), /spotlight shortcut bootstrap failed/)

    const api = mockWindow.nestify as NestifyApi
    const result = await api.registerSpotlightShortcut?.({ accelerator: 'Alt+Space' })
    assert.deepEqual(result, { ok: true })
  } finally {
    console.error = originalError
    delete mockWindow.__TAURI_INTERNALS__
    delete globalThis.window
  }

  const registration = calls.find(({ command }) => command === 'register_spotlight_shortcut')
  assert.deepEqual(registration?.args, { accelerator: 'Alt+Space' })

  const settingsSource = readFileSync(new URL('../components/app/SettingsDialog.tsx', import.meta.url), 'utf8')
  const updateIndex = settingsSource.indexOf('api.settingsUpdate')
  const registerIndex = settingsSource.indexOf('api.registerSpotlightShortcut')
  assert.ok(updateIndex >= 0)
  assert.ok(registerIndex > updateIndex)
})
