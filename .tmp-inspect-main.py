from pathlib import Path
p = Path('apps/desktop/electron/main.ts')
t = p.read_text(encoding='utf-8')
print('has lastSpotlight', 'lastSpotlightRequestAt' in t)
idx = t.find("window.webContents.on('before-input-event'")
print(t[idx:idx+900])
print('--- sendSpotlight ---')
idx = t.find('function sendSpotlightToggle')
print(t[idx:idx+900])
