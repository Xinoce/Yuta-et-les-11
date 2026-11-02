const path = require('node:path')
const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const { autoUpdater } = require('electron-updater')

let gameServer
let gameDatabase
let gameSockets
let mainWindow
let updateCheckStarted = false
let updateStatus = { state: 'idle', version: null, percent: 0, message: 'Les mises à jour sont prêtes à être vérifiées.', error: null }
const smokeTest = process.argv.includes('--smoke-test')
const hasSingleInstanceLock = smokeTest || app.requestSingleInstanceLock()

app.setAppUserModelId('fr.yutaetles11.table')

if (!hasSingleInstanceLock) {
  app.quit()
} else if (!smokeTest) {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

async function startGame() {
  process.env.DATA_DIR = path.join(app.getPath('userData'), 'data')
  process.env.COOKIE_SECURE = 'false'

  const { startServer, db, io, server } = await import('../server/index.js')
  gameServer = server
  gameDatabase = db
  gameSockets = io

  const preferredPort = smokeTest ? 0 : Number(process.env.PORT || 3001)
  await new Promise((resolve, reject) => {
    // The Electron UI and Cloudflare connector only need loopback access.
    // Binding to every interface can trigger a Windows Defender Firewall prompt.
    const host = '127.0.0.1'
    const onError = (error) => {
      if (!smokeTest && preferredPort !== 0 && error.code === 'EADDRINUSE') {
        server.removeListener('error', onError)
        console.warn(`Le port ${preferredPort} est déjà utilisé. Yuta et les 11 choisit un port libre.`)
        server.once('error', reject)
        try {
          startServer({ port: 0, host, onListening: resolve })
        } catch (fallbackError) {
          reject(fallbackError)
        }
        return
      }
      reject(error)
    }
    server.once('error', onError)
    try {
      startServer({ port: preferredPort, host, onListening: resolve })
    } catch (error) {
      reject(error)
    }
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

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#11120f',
    title: 'Yuta et les 11',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.once('ready-to-show', () => mainWindow.show())
  configureAutoUpdates(mainWindow)
  await mainWindow.loadURL(`http://127.0.0.1:${port}`)
}

function configureAutoUpdates(window) {
  if (updateCheckStarted) return
  updateCheckStarted = true
  const publish = (next) => {
    updateStatus = { ...updateStatus, ...next }
    if (!window.isDestroyed()) window.webContents.send('updates:status', updateStatus)
  }
  ipcMain.removeHandler('updates:get-status')
  ipcMain.removeHandler('updates:check')
  ipcMain.removeHandler('updates:install')
  ipcMain.handle('updates:get-status', () => ({ ...updateStatus, supported: app.isPackaged }))
  ipcMain.handle('updates:check', async () => {
    if (!app.isPackaged) return { ...updateStatus, state: 'unsupported', supported: false, message: 'Les mises à jour sont disponibles dans l’application installée.' }
    if (['checking', 'downloading'].includes(updateStatus.state)) return { ...updateStatus, supported: true }
    publish({ state: 'checking', version: null, percent: 0, error: null, message: 'Recherche des mises à jour…' })
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      publish({ state: 'error', error: error.message, message: 'La recherche de mise à jour a échoué.' })
    }
    return { ...updateStatus, supported: true }
  })
  ipcMain.handle('updates:install', () => {
    if (updateStatus.state !== 'downloaded') return false
    autoUpdater.quitAndInstall(false, true)
    return true
  })
  if (!app.isPackaged) {
    updateStatus = { state: 'unsupported', version: null, percent: 0, message: 'Les mises à jour sont disponibles dans l’application installée.', error: null }
    return
  }
  autoUpdater.logger = console
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('checking-for-update', () => publish({ state: 'checking', error: null, message: 'Recherche des mises à jour…' }))
  autoUpdater.on('error', (error) => {
    console.warn('Vérification de mise à jour impossible :', error.message)
    publish({ state: 'error', error: error.message, message: 'La recherche ou le téléchargement a échoué.' })
  })
  autoUpdater.on('update-available', (info) => {
    console.info(`Mise à jour ${info.version} disponible.`)
    publish({ state: 'downloading', version: info.version, percent: 0, error: null, message: `Téléchargement de la version ${info.version}…` })
  })
  autoUpdater.on('download-progress', (progress) => publish({ state: 'downloading', percent: Math.round(progress.percent), message: `Téléchargement de la mise à jour… ${Math.round(progress.percent)} %` }))
  autoUpdater.on('update-not-available', () => {
    console.info('Yuta et les 11 est à jour.')
    publish({ state: 'current', version: app.getVersion(), percent: 0, error: null, message: 'Tu utilises déjà la dernière version.' })
  })
  autoUpdater.on('update-downloaded', (info) => publish({ state: 'downloaded', version: info.version, percent: 100, error: null, message: `La version ${info.version} est prête à être installée. Redémarre quand tu veux.` }))
  setTimeout(() => {
    publish({ state: 'checking', message: 'Recherche automatique des mises à jour…' })
    autoUpdater.checkForUpdates().catch((error) => {
      console.warn('Vérification de mise à jour impossible :', error.message)
      publish({ state: 'error', error: error.message, message: 'La recherche ou le téléchargement a échoué.' })
    })
  }, 10000)
}

app.whenReady().then(() => hasSingleInstanceLock ? startGame() : undefined).catch((error) => {
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
