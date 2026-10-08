export type SessionRow = {
  source: string
  id: string
  name: string
  harness: string
  state: string
  section: 'needs' | 'working' | 'idle' | 'acp' | 'dead'
  detail: string
  ageMs: number | null
}

export type Overview = {
  now: string
  hub: 'running' | 'down'
  sessions: SessionRow[]
  acp: SessionRow[]
}

declare module 'claude-code' {
  interface PluginState {
    'bdb-aos-sessions': {
      overview: Overview | null
      error: string
      at: number
    }
  }
}
