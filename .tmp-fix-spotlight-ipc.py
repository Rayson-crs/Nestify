from pathlib import Path

preload = Path('apps/desktop/electron/preload.ts')
text = preload.read_text(encoding='utf-8')
old = '''type UiEvent = 'window:close-requested' | 'spotlight:toggle'
'''
new = '''type UiEvent = 'window:close-requested' | 'spotlight:open'
'''
if old not in text:
    raise SystemExit('preload UiEvent missing')
text = text.replace(old, new, 1)
old = '''    const spotlightListener = () => listener('spotlight:toggle')
    ipcRenderer.on('window:close-requested', closeListener)
    ipcRenderer.on('ui:spotlight-toggle', spotlightListener)
    return () => {
      ipcRenderer.off('window:close-requested', closeListener)
      ipcRenderer.off('ui:spotlight-toggle', spotlightListener)
    }
'''
new = '''    const spotlightListener = () => listener('spotlight:open')
    ipcRenderer.on('window:close-requested', closeListener)
    ipcRenderer.on('ui:spotlight-open', spotlightListener)
    return () => {
      ipcRenderer.off('window:close-requested', closeListener)
      ipcRenderer.off('ui:spotlight-open', spotlightListener)
    }
'''
if old not in text:
    raise SystemExit('preload listener missing')
text = text.replace(old, new, 1)
preload.write_text(text, encoding='utf-8')
print('preload updated')

ipc = Path('apps/desktop/src/lib/ipc.ts')
text = ipc.read_text(encoding='utf-8')
old = "export type NestifyUiEvent = 'window:close-requested' | 'spotlight:toggle'"
new = "export type NestifyUiEvent = 'window:close-requested' | 'spotlight:open'"
if old not in text:
    raise SystemExit('ipc event type missing')
ipc.write_text(text.replace(old, new, 1), encoding='utf-8')
print('ipc.ts updated')
