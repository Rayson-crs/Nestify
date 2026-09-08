const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  console.log('[smoke] ready')
  const win = new BrowserWindow({ width: 800, height: 600, show: true })
  console.log('[smoke] created', win.id)
  win.loadURL('data:text/html;charset=utf-8,<body style="font:24px system-ui">Electron smoke OK</body>')
  setTimeout(() => console.log('[smoke] visible', win.isVisible()), 1000)
})
