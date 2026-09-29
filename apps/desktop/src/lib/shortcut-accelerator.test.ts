import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureAccelerator } from './shortcut-accelerator'

test('captures Ctrl+Space from the physical key even when IME changes the key name', () => {
  const result = captureAccelerator({
    key: 'Process',
    code: 'Space',
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  })

  assert.deepEqual(result, { type: 'ok', accelerator: 'Control+Space' })
})

test('waits for keyup when an IME reports no physical code', () => {
  const result = captureAccelerator({
    key: 'Process',
    code: '',
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    type: 'keydown',
  })

  assert.deepEqual(result, { type: 'defer' })
})
