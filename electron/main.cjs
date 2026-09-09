const { app, BrowserWindow, ipcMain, shell, screen, globalShortcut } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const { setupAutoUpdater } = require('./autoUpdate.cjs')
const { forceTopmost, findLeagueWindowBounds } = require('./winTopmost.cjs')

const isDev = !app.isPackaged
const API_PORT = process.env.PORT || 8787
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'
const PROD_URL = `http://127.0.0.1:${API_PORT}`

let mainWindow = null
let overlayWindow = null
let apiProcess = null
let overlayClickThrough = false
let overlayKeepAliveTimer = null
/** Si l’utilisateur déplace l’overlay, on arrête de le re-pin tant qu’il est ouvert */
let overlayUserMoved = false
let overlayPinQuiet = false

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

function baseUiUrl() {
  return isDev ? DEV_URL : PROD_URL
}

function applyOverlayClickThrough(enabled) {
  overlayClickThrough = Boolean(enabled)
  if (!overlayWindow || overlayWindow.isDestroyed()) return overlayClickThrough
  if (overlayClickThrough) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  } else {
    overlayWindow.setIgnoreMouseEvents(false)
  }
  return overlayClickThrough
}

function positionOverlay(win, bounds) {
  const [ww, wh] = win.getSize()
  let x
  let y
  if (bounds && bounds.width > 100) {
    x = Math.round(bounds.x + bounds.width - ww - 16)
    y = Math.round(bounds.y + 48)
  } else {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const { workArea } = display
    x = Math.round(workArea.x + workArea.width - ww - 24)
    y = Math.round(workArea.y + 48)
  }
  overlayPinQuiet = true
  win.setPosition(x, y)
  setTimeout(() => {
    overlayPinQuiet = false
  }, 80)
}

function assertOverlayAboveGame() {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return
  forceTopmost(overlayWindow)
  if (!overlayUserMoved) {
    const league = findLeagueWindowBounds()
    if (league) positionOverlay(overlayWindow, league)
  }
}

function startOverlayKeepAlive() {
  stopOverlayKeepAlive()
  overlayKeepAliveTimer = setInterval(() => {
    assertOverlayAboveGame()
  }, 700)
}

function stopOverlayKeepAlive() {
  if (overlayKeepAliveTimer) {
    clearInterval(overlayKeepAliveTimer)
    overlayKeepAliveTimer = null
  }
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    // Ne JAMAIS focus() — ça descend League / vole le clavier
    overlayWindow.showInactive()
    forceTopmost(overlayWindow)
    startOverlayKeepAlive()
    return overlayWindow
  }

  overlayUserMoved = false

  overlayWindow = new BrowserWindow({
    width: 460,
    height: 340,
    minWidth: 360,
    minHeight: 180,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    thickFrame: false,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    title: 'AETHER Overlay',
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  forceTopmost(overlayWindow)
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  positionOverlay(overlayWindow, findLeagueWindowBounds())

  const url = `${baseUiUrl()}?view=overlay`
  overlayWindow.loadURL(url)

  overlayWindow.once('ready-to-show', () => {
    overlayWindow?.showInactive()
    forceTopmost(overlayWindow)
    applyOverlayClickThrough(overlayClickThrough)
    startOverlayKeepAlive()
  })

  overlayWindow.on('move', () => {
    if (!overlayPinQuiet) overlayUserMoved = true
  })

  overlayWindow.on('closed', () => {
    stopOverlayKeepAlive()
    overlayWindow = null
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('overlay:state', { open: false, clickThrough: overlayClickThrough })
    }
  })

  return overlayWindow
}

function setOverlayOpen(open) {
  if (open) {
    createOverlayWindow()
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.showInactive()
      forceTopmost(overlayWindow)
      startOverlayKeepAlive()
    }
  } else if (overlayWindow && !overlayWindow.isDestroyed()) {
    stopOverlayKeepAlive()
    overlayWindow.hide()
  }
  const isOpen = Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible())
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('overlay:state', { open: isOpen, clickThrough: overlayClickThrough })
  }
  return { open: isOpen, clickThrough: overlayClickThrough }
}

function toggleOverlay() {
  const isOpen = Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible())
  if (isOpen) {
    stopOverlayKeepAlive()
    overlayWindow.hide()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('overlay:state', { open: false, clickThrough: overlayClickThrough })
    }
    return { open: false, clickThrough: overlayClickThrough }
  }
  createOverlayWindow()
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.showInactive()
    forceTopmost(overlayWindow)
    startOverlayKeepAlive()
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('overlay:state', { open: true, clickThrough: overlayClickThrough })
  }
  return { open: true, clickThrough: overlayClickThrough }
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

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('mailto:')) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  mainWindow.loadURL(baseUiUrl())

  mainWindow.on('closed', () => {
    mainWindow = null
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close()
      overlayWindow = null
    }
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

ipcMain.handle('overlay:toggle', () => toggleOverlay())
ipcMain.handle('overlay:show', () => setOverlayOpen(true))
ipcMain.handle('overlay:hide', () => setOverlayOpen(false))
ipcMain.handle('overlay:getState', () => ({
  open: Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()),
  clickThrough: overlayClickThrough,
}))
ipcMain.handle('overlay:setClickThrough', (_event, enabled) => {
  const value = applyOverlayClickThrough(Boolean(enabled))
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('overlay:state', {
      open: Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()),
      clickThrough: value,
    })
  }
  return value
})

function registerShortcuts() {
  try {
    globalShortcut.register('CommandOrControl+Shift+O', () => {
      toggleOverlay()
    })
    globalShortcut.register('CommandOrControl+Shift+P', () => {
      applyOverlayClickThrough(!overlayClickThrough)
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('overlay:state', {
          open: overlayWindow.isVisible(),
          clickThrough: overlayClickThrough,
        })
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('overlay:state', {
          open: Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()),
          clickThrough: overlayClickThrough,
        })
      }
    })
  } catch (error) {
    console.warn('[aether] Raccourcis overlay indisponibles:', error)
  }
}

app.commandLine.appendSwitch('enable-transparent-visuals')

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
    registerShortcuts()
  } catch (error) {
    console.error(error)
    app.quit()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (apiProcess) {
    apiProcess.kill()
    apiProcess = null
  }
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  globalShortcut.unregisterAll()
  if (apiProcess) {
    apiProcess.kill()
    apiProcess = null
  }
})
