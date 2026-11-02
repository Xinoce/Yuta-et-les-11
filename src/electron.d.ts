export {}

declare global {
  interface Window {
    yutaUpdater?: {
      getStatus: () => Promise<{
        state: 'idle' | 'checking' | 'downloading' | 'current' | 'downloaded' | 'error' | 'unsupported'
        version: string | null
        percent: number
        message: string
        error: string | null
        supported?: boolean
      }>
      check: () => Promise<{
        state: 'idle' | 'checking' | 'downloading' | 'current' | 'downloaded' | 'error' | 'unsupported'
        version: string | null
        percent: number
        message: string
        error: string | null
        supported?: boolean
      }>
      install: () => Promise<boolean>
      onStatus: (callback: (status: {
        state: 'idle' | 'checking' | 'downloading' | 'current' | 'downloaded' | 'error' | 'unsupported'
        version: string | null
        percent: number
        message: string
        error: string | null
        supported?: boolean
      }) => void) => () => void
    }
  }
}
