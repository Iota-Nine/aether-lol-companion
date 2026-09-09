const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aetherDesktop', {
  isDesktop: true,
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  getUpdateState: () => ipcRenderer.invoke('update:getState'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('update:state', handler)
    return () => ipcRenderer.removeListener('update:state', handler)
  },
  overlayToggle: () => ipcRenderer.invoke('overlay:toggle'),
  overlayShow: () => ipcRenderer.invoke('overlay:show'),
  overlayHide: () => ipcRenderer.invoke('overlay:hide'),
  overlayGetState: () => ipcRenderer.invoke('overlay:getState'),
  overlaySetClickThrough: (enabled) => ipcRenderer.invoke('overlay:setClickThrough', enabled),
  onOverlayState: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('overlay:state', handler)
    return () => ipcRenderer.removeListener('overlay:state', handler)
  },
})
