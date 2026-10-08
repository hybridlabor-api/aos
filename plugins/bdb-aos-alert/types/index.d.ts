export type AlertState = { active: boolean; reason: string; since: number }

declare module 'claude-code' {
  interface PluginState {
    'bdb-aos-alert': {
      alert: AlertState
      frame: number
    }
  }
}
