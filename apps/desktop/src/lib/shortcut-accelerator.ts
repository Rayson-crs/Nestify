export type AcceleratorKeyEvent = {
  key: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  type?: string
}

export type AcceleratorCapture =
  | { type: 'ignore' }
  | { type: 'cancel' }
  | { type: 'defer' }
  | { type: 'needs-modifier' }
  | { type: 'unsupported' }
  | { type: 'ok'; accelerator: string }

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Backspace: 'Backspace',
  CapsLock: 'CapsLock',
  NumLock: 'Numlock',
  ScrollLock: 'ScrollLock',
  Pause: 'Pause',
  PrintScreen: 'PrintScreen',
  Minus: 'Minus',
  Equal: 'Equal',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
  Backquote: 'Backquote',
  BracketLeft: 'BracketLeft',
  BracketRight: 'BracketRight',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Escape: 'Escape',
  NumpadAdd: 'NumAdd',
  NumpadSubtract: 'NumSubtract',
  NumpadMultiply: 'NumMultiply',
  NumpadDivide: 'NumDivide',
  NumpadDecimal: 'NumDecimal',
  NumpadEnter: 'NumEnter',
}

function isModifier(event: AcceleratorKeyEvent): boolean {
  return event.key === 'Control'
    || event.key === 'Shift'
    || event.key === 'Alt'
    || event.key === 'Meta'
    || event.key === 'OS'
    || event.code.startsWith('Control')
    || event.code.startsWith('Shift')
    || event.code.startsWith('Alt')
    || event.code.startsWith('Meta')
    || event.code === 'OSLeft'
    || event.code === 'OSRight'
}

function keyFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1]
  const numpad = /^Numpad([0-9])$/.exec(code)
  if (numpad) return `Num${numpad[1]}`
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(code)) return code
  return CODE_KEYS[code] ?? null
}

function keyFromEventKey(key: string): string | null {
  if (key === ' ' || key === 'Spacebar' || key === 'Space') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(key)) return key
  return CODE_KEYS[key] ?? null
}

export function captureAccelerator(event: AcceleratorKeyEvent): AcceleratorCapture {
  if (isModifier(event)) return { type: 'ignore' }
  if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
    return { type: 'cancel' }
  }

  const key = keyFromCode(event.code) ?? keyFromEventKey(event.key)
  if (!key) {
    const imeHoldingKey = event.key === 'Process' || event.key === 'Unidentified' || event.key === 'Dead'
    if (imeHoldingKey && event.type !== 'keyup') return { type: 'defer' }
    return { type: 'unsupported' }
  }
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return { type: 'needs-modifier' }

  const modifiers = [
    event.ctrlKey ? 'Control' : null,
    event.altKey ? 'Alt' : null,
    event.shiftKey ? 'Shift' : null,
    event.metaKey ? 'Meta' : null,
  ].filter((part): part is string => part !== null)
  return { type: 'ok', accelerator: [...modifiers, key].join('+') }
}
