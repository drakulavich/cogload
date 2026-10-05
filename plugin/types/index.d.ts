export type Level = 'Calm' | 'Warming' | 'Heating' | 'Fried'

export type Status = {
  schema: 1
  asOf: string
  date: string
  hour: number
  index: number | null
  level: Level | null
  peak: number | null
  activeMin: number
  streakMin: number
}

declare module 'claude-code' {
  interface PluginState {
    'cognitive-load': { status: Status | null; lastToast: number }
  }
}
