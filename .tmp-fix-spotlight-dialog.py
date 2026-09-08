from pathlib import Path
p = Path('apps/desktop/src/components/files/SpotlightSearch.tsx')
text = p.read_text(encoding='utf-8')
old = '''    <Dialog open={open} onOpenChange={(next) => enabled && onOpenChange(next)}>
      <DialogContent
        showCloseButton={false}
        className="top-[18%] max-w-xl translate-y-[-18vh] gap-0 overflow-hidden p-0"
      >
'''
new = '''    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!enabled) return
        if (!next && typeof window !== 'undefined') {
          const keyboard = window.event
          if (keyboard instanceof KeyboardEvent && keyboard.ctrlKey && keyboard.key === 'Escape') return
        }
        onOpenChange(next)
      }}
    >
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (event.ctrlKey) event.preventDefault()
        }}
        className="top-[18%] max-w-xl translate-y-[-18vh] gap-0 overflow-hidden p-0"
      >
'''
if old not in text:
    raise SystemExit('spotlight dialog missing')
p.write_text(text.replace(old, new, 1), encoding='utf-8')
print('SpotlightSearch patched')
