export {}

export type UpdateState = {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'up-to-date' | 'disabled'
  version: string | null
  progress: number
  message: string
  appVersion?: string
  installInSeconds?: number | null
}

declare global {
  interface Window {
    aetherDesktop?: {
      isDesktop: boolean
      minimize: () => Promise<void>
      maximize: () => Promise<boolean>
      close: () => Promise<void>
      isMaximized: () => Promise<boolean>
      getUpdateState: () => Promise<UpdateState>
      checkForUpdates: () => Promise<UpdateState>
      installUpdate: () => Promise<boolean>
      onUpdateState: (callback: (state: UpdateState) => void) => () => void
    }
  }
}
