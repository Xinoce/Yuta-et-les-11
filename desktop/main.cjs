const path = require('node:path')
const { app, BrowserWindow, dialog } = require('electron')
const { autoUpdater } = require('electron-updater')

let gameServer
let gameDatabase
let gameSockets
let updateCheckStarted = false

app.setAppUserModelId('fr.yutaetles11.table')

async function startGame() {
  const smokeTest = process.argv.includes('--smoke-test')
  process.env.DATA_DIR = path.join(app.getPath('userData'), 'data')
  process.env.COOKIE_SECURE = 'false'

  const { startServer, db, io, server } = await import('../server/index.js')
  gameServer = server
  gameDatabase = db
  gameSockets = io

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    startServer({ port: smokeTest ? 0 : Number(process.env.PORT || 3001), host: '0.0.0.0', onListening: resolve })
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 3001
  if (smokeTest) {
    const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`)
    if (!response.ok) throw new Error(`L’API locale a répondu ${response.status}.`)
    console.log('YUTA_DESKTOP_SMOKE_OK', await response.text())
    app.quit()
    return
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#11120f',
    title: 'Yuta et les 11',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.once('ready-to-show', () => window.show())
  await window.loadURL(`http://127.0.0.1:${port}`)
  configureAutoUpdates(window)
}

function configureAutoUpdates(window) {
  if (!app.isPackaged || updateCheckStarted) return
  updateCheckStarted = true
  autoUpdater.logger = console
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('error', (error) => console.warn('Vérification de mise à jour impossible :', error.message))
  autoUpdater.on('update-available', (info) => console.info(`Mise à jour ${info.version} disponible.`))
  autoUpdater.on('update-not-available', () => console.info('Yuta et les 11 est à jour.'))
  autoUpdater.on('update-downloaded', async (info) => {
    if (window.isDestroyed()) return
    const choice = await dialog.showMessageBox(window, {
      type: 'info',
      title: 'Mise à jour prête',
      message: `La version ${info.version} est téléchargée.`,
      detail: 'Redémarre maintenant pour installer la mise à jour. Ta campagne et tes images resteront enregistrées.',
      buttons: ['Redémarrer et installer', 'Plus tard'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (choice.response === 0) autoUpdater.quitAndInstall(false, true)
  })
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => console.warn('Vérification de mise à jour impossible :', error.message))
  }, 10000)
}

app.whenReady().then(startGame).catch((error) => {
  if (process.argv.includes('--smoke-test')) {
    console.error('YUTA_DESKTOP_SMOKE_FAILED', error)
    app.exit(1)
    return
  }
  dialog.showErrorBox('Yuta et les 11', `L’application n’a pas pu démarrer.\n\n${error.message}`)
  app.quit()
})

app.on('before-quit', () => {
  if (gameSockets) gameSockets.close()
  if (gameDatabase?.open) gameDatabase.close()
  else if (gameServer?.listening) gameServer.close()
})

app.on('window-all-closed', () => app.quit())

