/**
 * Win32 helpers - garder l’overlay TOPMOST au-dessus de League (borderless).
 * Plein écran exclusif = impossible sans hook DirectX.
 */
let koffi = null
try {
  koffi = require('koffi')
} catch {
  koffi = null
}

const GWL_EXSTYLE = -20
const WS_EX_TOPMOST = 0x00000008
const WS_EX_NOACTIVATE = 0x08000000
const WS_EX_TOOLWINDOW = 0x00000080
const SWP_NOSIZE = 0x0001
const SWP_NOMOVE = 0x0002
const SWP_NOACTIVATE = 0x0010

let api = null
let RECT = null

function loadApi() {
  if (api) return api
  if (!koffi || process.platform !== 'win32') return null
  try {
    RECT = koffi.struct('RECT', {
      left: 'long',
      top: 'long',
      right: 'long',
      bottom: 'long',
    })
    const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void *hWnd, intptr lParam)')
    const user32 = koffi.load('user32.dll')
    api = {
      EnumWindowsProc,
      SetWindowPos: user32.func(
        'bool __stdcall SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, uint32 uFlags)',
      ),
      GetWindowLongPtrW: user32.func('uintptr __stdcall GetWindowLongPtrW(void *hWnd, int nIndex)'),
      SetWindowLongPtrW: user32.func('uintptr __stdcall SetWindowLongPtrW(void *hWnd, int nIndex, uintptr dwNewLong)'),
      IsWindow: user32.func('bool __stdcall IsWindow(void *hWnd)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(void *hWnd)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void *hWnd, void *lpString, int nMaxCount)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(void *hWnd, _Out_ RECT *lpRect)'),
      EnumWindows: user32.func('bool __stdcall EnumWindows(EnumWindowsProc *lpEnumFunc, intptr lParam)'),
    }
  } catch (error) {
    console.warn('[aether] Win32 overlay API indisponible:', error)
    api = null
  }
  return api
}

function hwndBuf(browserWindow) {
  if (!browserWindow || browserWindow.isDestroyed()) return null
  try {
    return browserWindow.getNativeWindowHandle()
  } catch {
    return null
  }
}

function forceTopmost(browserWindow) {
  if (!browserWindow || browserWindow.isDestroyed()) return false

  try {
    browserWindow.setAlwaysOnTop(true, 'screen-saver')
    if (typeof browserWindow.moveTop === 'function') browserWindow.moveTop()
  } catch {
    /* ignore */
  }

  const winApi = loadApi()
  const hWnd = hwndBuf(browserWindow)
  if (!winApi || !hWnd) return false

  try {
    if (!winApi.IsWindow(hWnd)) return false

    let ex = Number(winApi.GetWindowLongPtrW(hWnd, GWL_EXSTYLE))
    if (!Number.isFinite(ex)) ex = 0
    ex |= WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW
    winApi.SetWindowLongPtrW(hWnd, GWL_EXSTYLE, ex)

    // HWND_TOPMOST = (HWND)-1
    const topmost = koffi.as(-1, 'void *')
    winApi.SetWindowPos(hWnd, topmost, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
    return true
  } catch (error) {
    console.warn('[aether] forceTopmost failed:', error)
    return false
  }
}

function windowTitle(winApi, hWnd) {
  const buf = Buffer.alloc(1024)
  const n = winApi.GetWindowTextW(hWnd, buf, 512)
  if (!n) return ''
  return buf.toString('utf16le', 0, n * 2)
}

/**
 * Rect de la fenêtre League in-game (ou client) pour ancrer l’overlay.
 */
function findLeagueWindowBounds() {
  const winApi = loadApi()
  if (!winApi || !koffi) return null

  const candidates = []
  let cb = null
  try {
    const EnumWindowsProc = winApi.EnumWindowsProc
    cb = koffi.register((hWnd) => {
      try {
        if (!winApi.IsWindowVisible(hWnd)) return true
        const title = windowTitle(winApi, hWnd)
        if (!title) return true
        const lower = title.toLowerCase()
        const isLol =
          lower.includes('league of legends') ||
          lower.includes('(tm) client') ||
          lower === 'league of legends (tm) client'
        if (!isLol) return true

        const rect = {}
        if (!winApi.GetWindowRect(hWnd, rect)) return true
        const width = rect.right - rect.left
        const height = rect.bottom - rect.top
        if (width < 640 || height < 360) return true

        let score = width * height
        if (lower.includes('(tm) client')) score += 50_000_000
        if (lower.includes('riot client')) score -= 20_000_000
        candidates.push({
          title,
          x: rect.left,
          y: rect.top,
          width,
          height,
          score,
        })
      } catch {
        /* skip window */
      }
      return true
    }, koffi.pointer(EnumWindowsProc))

    winApi.EnumWindows(cb, 0)
  } catch (error) {
    console.warn('[aether] findLeagueWindowBounds failed:', error)
    return null
  } finally {
    if (cb) {
      try {
        koffi.unregister(cb)
      } catch {
        /* ignore */
      }
    }
  }

  if (!candidates.length) return null
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]
}

module.exports = {
  forceTopmost,
  findLeagueWindowBounds,
  isWin32Native: () => Boolean(loadApi()),
}
