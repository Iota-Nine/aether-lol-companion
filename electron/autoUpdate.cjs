const { autoUpdater } = require('electron-updater')
const { app, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')

/** @type {import('electron').BrowserWindow | null} */
let targetWindow = null
let started = false
let ipcReady = false
let checkTimer = null
let focusHooked = false
/** @type {ReturnType<typeof setInterval> | null} */
let installCountdown = null

const CHECK_EVERY_MS = 5 * 60 * 1000 // toutes les 5 min tant que l'app reste ouverte
const FIRST_CHECK_MS = 4000
const AUTO_INSTALL_AFTER_MS = 2 * 60 * 1000 // 2 min après téléchargement si pas d'action

const state = {
  status: 'idle',
  version: null,
  progress: 0,
  message: '',
  installInSeconds: null,
}

function send(channel, payload) {
  if (!targetWindow || targetWindow.isDestroyed()) return
  targetWindow.webContents.send(channel, payload)
}

function emitState(extra = {}) {
  const payload = { ...state, ...extra, appVersion: app.getVersion() }
  send('update:state', payload)
  return payload
}

function clearInstallCountdown() {
  if (installCountdown) {
    clearInterval(installCountdown)
    installCountdown = null
  }
  state.installInSeconds = null
}

function startInstallCountdown() {
  clearInstallCountdown()
  let left = Math.round(AUTO_INSTALL_AFTER_MS / 1000)
  state.installInSeconds = left
  state.message = `v${state.version} prête — installation auto dans ${left}s (ou clique REDÉMARRER)`
  emitState()

  installCountdown = setInterval(() => {
    left -= 1
    state.installInSeconds = left
    if (left <= 0) {
      clearInstallCountdown()
      state.message = `Installation de v${state.version}…`
      emitState()
      autoUpdater.quitAndInstall(false, true)
      return
    }
    state.message = `v${state.version} prête — installation auto dans ${left}s (ou clique REDÉMARRER)`
    emitState()
  }, 1000)
}

function canStartCheck() {
  return (
    state.status !== 'disabled' &&
    state.status !== 'downloading' &&
    state.status !== 'available' &&
    state.status !== 'ready'
  )
}

function runCheck(reason = 'timer') {
  if (!canStartCheck()) return
  autoUpdater.checkForUpdates().catch((err) => {
    // Ne pas écraser une MAJ déjà prête
    if (state.status === 'ready' || state.status === 'downloading') return
    state.status = 'error'
    state.message = err?.message || String(err)
    emitState()
    console.warn('[aether] update check failed:', reason, err)
  })
}

function ensureIpc() {
  if (ipcReady) return
  ipcReady = true

  ipcMain.handle('update:getState', () => emitState())
  ipcMain.handle('update:check', async () => {
    if (state.status === 'disabled') return emitState()
    if (state.status === 'ready') return emitState()
    try {
      if (canStartCheck()) {
        state.status = 'checking'
        state.message = 'Recherche d’une mise à jour…'
        emitState()
        await autoUpdater.checkForUpdates()
      }
      return emitState()
    } catch (e) {
      if (state.status === 'ready' || state.status === 'downloading') return emitState()
      state.status = 'error'
      state.message = e instanceof Error ? e.message : String(e)
      return emitState()
    }
  })
  ipcMain.handle('update:install', () => {
    clearInstallCountdown()
    autoUpdater.quitAndInstall(false, true)
    return true
  })
}

function loadUpdateConfig() {
  const candidates = [
    path.join(__dirname, 'update-config.json'),
    path.join(process.resourcesPath || '', 'update-config.json'),
  ]
  for (const file of candidates) {
    try {
      if (file && fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf8'))
      }
    } catch {
      // ignore
    }
  }
  return null
}

function applyFeed(config) {
  if (!config) return false

  if (config.provider === 'generic' && config.url) {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: String(config.url).replace(/\/$/, ''),
    })
    return true
  }

  if (config.provider === 'github' && config.owner && config.repo) {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: config.owner,
      repo: config.repo,
      private: Boolean(config.private),
      releaseType: 'release',
    })
    return true
  }

  return false
}

function isPlaceholder(config) {
  if (!config) return false
  const owner = String(config.owner || '')
  return (
    owner === 'TON_GITHUB' ||
    owner === 'TON_PSEUDO_GITHUB' ||
    owner.startsWith('TON_') ||
    config.repo === 'TON_REPO'
  )
}

function hookWindowFocus(win) {
  if (focusHooked || !win) return
  focusHooked = true
  win.on('focus', () => {
    runCheck('focus')
  })
}

function setupAutoUpdater(win) {
  targetWindow = win
  ensureIpc()
  hookWindowFocus(win)

  if (started) {
    emitState()
    return
  }
  started = true

  if (!app.isPackaged) {
    state.status = 'disabled'
    state.message =
      'Auto-update OFF (mode dev). Installe AETHER-Setup depuis GitHub Releases pour recevoir les MAJ.'
    emitState()
    return
  }

  const config = loadUpdateConfig()
  if (isPlaceholder(config)) {
    state.status = 'disabled'
    state.message =
      'Configure electron/update-config.json avec ton GitHub (owner/repo), puis publie une release.'
    emitState()
    return
  }

  applyFeed(config)

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false

  autoUpdater.on('checking-for-update', () => {
    if (state.status === 'ready' || state.status === 'downloading') return
    state.status = 'checking'
    state.message = 'Recherche d’une mise à jour…'
    emitState()
  })

  autoUpdater.on('update-available', (info) => {
    state.status = 'available'
    state.version = info.version
    state.progress = 0
    state.message = `Version ${info.version} disponible — téléchargement…`
    emitState()
  })

  autoUpdater.on('update-not-available', () => {
    if (state.status === 'ready' || state.status === 'downloading') return
    state.status = 'up-to-date'
    state.message = 'AETHER est à jour.'
    emitState()
  })

  autoUpdater.on('download-progress', (p) => {
    state.status = 'downloading'
    state.progress = Math.round(p.percent || 0)
    state.message = `Téléchargement ${state.progress}%`
    emitState()
  })

  autoUpdater.on('update-downloaded', (info) => {
    state.status = 'ready'
    state.version = info.version
    state.progress = 100
    emitState()
    // N'attend pas que l'utilisateur ferme l'app : install auto après countdown
    startInstallCountdown()
  })

  autoUpdater.on('error', (err) => {
    if (state.status === 'ready' || state.status === 'downloading') return
    state.status = 'error'
    state.message = err?.message || 'Erreur de mise à jour'
    emitState()
  })

  setTimeout(() => runCheck('startup'), FIRST_CHECK_MS)
  if (checkTimer) clearInterval(checkTimer)
  checkTimer = setInterval(() => runCheck('interval'), CHECK_EVERY_MS)
}

module.exports = { setupAutoUpdater }
