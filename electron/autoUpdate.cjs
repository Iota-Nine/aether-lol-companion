const { autoUpdater } = require('electron-updater')
const { app, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')

/** @type {import('electron').BrowserWindow | null} */
let targetWindow = null
let started = false
let ipcReady = false

const state = {
  status: 'idle',
  version: null,
  progress: 0,
  message: '',
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

function ensureIpc() {
  if (ipcReady) return
  ipcReady = true

  ipcMain.handle('update:getState', () => emitState())
  ipcMain.handle('update:check', async () => {
    if (state.status === 'disabled') return emitState()
    try {
      state.status = 'checking'
      emitState()
      await autoUpdater.checkForUpdates()
      return emitState()
    } catch (e) {
      state.status = 'error'
      state.message = e instanceof Error ? e.message : String(e)
      return emitState()
    }
  })
  ipcMain.handle('update:install', () => {
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

function setupAutoUpdater(win) {
  targetWindow = win
  ensureIpc()

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
    state.message = `v${info.version} prête — redémarre pour installer`
    emitState()
  })

  autoUpdater.on('error', (err) => {
    state.status = 'error'
    state.message = err?.message || 'Erreur de mise à jour'
    emitState()
  })

  const check = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      state.status = 'error'
      state.message = err?.message || String(err)
      emitState()
    })
  }

  setTimeout(check, 4000)
  setInterval(check, 30 * 60 * 1000)
}

module.exports = { setupAutoUpdater }
