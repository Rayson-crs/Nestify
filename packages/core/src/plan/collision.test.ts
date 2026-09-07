import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveCollision } from './collision.ts'

test('suffix collision appends (1) before extension', () => {
  const occupied = new Set(['D:/lib/docs.txt'])
  const resolved = resolveCollision(
    'D:/lib/docs.txt',
    { has: (path) => occupied.has(path) },
    'suffix',
    false,
  )
  assert.equal(resolved.path, 'D:/lib/docs (1).txt')
  assert.equal(resolved.selected, true)
  assert.equal(resolved.risk, 'none')
})

test('overwrite marks risk and does not auto-select', () => {
  const resolved = resolveCollision(
    'D:/lib/docs.txt',
    { has: () => true },
    'overwrite',
    false,
  )
  assert.equal(resolved.path, 'D:/lib/docs.txt')
  assert.equal(resolved.risk, 'overwrite')
  assert.equal(resolved.selected, false)
})

test('skip leaves the destination empty', () => {
  const resolved = resolveCollision('D:/lib/docs.txt', { has: () => true }, 'skip', false)
  assert.equal(resolved.path, null)
  assert.equal(resolved.risk, 'occupied')
  assert.equal(resolved.selected, false)
})
