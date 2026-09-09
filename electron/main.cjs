const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const { setupAutoUpdater } = require('./autoUpdate.cjs')

const isDev = !app.isPackaged
const API_PORT = process.env.PORT || 8787
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'
const PROD_URL = `http://127.0.0.1:${API_PORT}`

let mainWindow = null
let apiProcess = null

function waitForUrl(url, timeoutMs = 90000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume()
        resolve(true)
      })
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout en attendant ${url}`))
          return
        }
        setTimeout(tick, 400)
      })
    }
    tick()
  })
}

function getUiPath() {
  if (isDev) return path.join(__dirname, '..', 'dist')
  return path.join(process.resourcesPath, 'ui')
}

function getServerEntry() {
  if (isDev) {
    return {
      entry: path.join(__dirname, '..', 'server', 'index.ts'),
      viaTsx: true,
    }
  }
  return {
    entry: path.join(process.resourcesPath, 'dist-server', 'index.cjs'),
    viaTsx: false,
  }
}

function startApiServer() {
  if (apiProcess) return

  const { entry, viaTsx } = getServerEntry()
  if (!fs.existsSync(entry)) {
    console.error('[aether] Server introuvable:', entry)
    return
  }

  const args = viaTsx
    ? [path.join(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'), entry]
    : [entry]

  apiProcess = spawn(process.execPath, args, {
    cwd: isDev ? path.join(__dirname, '..') : path.dirname(entry),
    env: {
      ...process.env,
      PORT: String(API_PORT),
      AETHER_UI_PATH: getUiPath(),
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: 'inherit',
  })

  apiProcess.on('exit', (code) => {
    apiProcess = null
    if (code && code !== 0) {
      console.error(`[aether] API arrêtée (code ${code})`)
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#05070c',
    show: false,
    autoHideMenuBar: true,
    title: 'AETHER — LoL Companion',
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Enregistrer les handlers IPC avant le chargement UI (évite update:getState sans handler)
  setupAutoUpdater(mainWindow)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const target = isDev ? DEV_URL : PROD_URL
  mainWindow.loadURL(target)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return false
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
    return false
  }
  mainWindow.maximize()
  return true
})

ipcMain.handle('window:close', () => {
  mainWindow?.close()
})

ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

app.whenReady().then(async () => {
  try {
    if (isDev) {
      await waitForUrl(`http://127.0.0.1:${API_PORT}/api/health`)
      await waitForUrl(DEV_URL)
    } else {
      startApiServer()
      await waitForUrl(`http://127.0.0.1:${API_PORT}/api/health`)
    }
    createWindow()
  } catch (error) {
    console.error(error)
    app.quit()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (apiProcess) {
    apiProcess.kill()
    apiProcess = null
  }
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (apiProcess) {
    apiProcess.kill()
    apiProcess = null
  }
})
