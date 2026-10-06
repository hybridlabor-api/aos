export type FleetRole = 'master' | 'task-manager' | 'orchestrator' | 'worker'

export type FleetActivity = 'working' | 'idle' | 'attention'

export type FleetProgress = { done: number; total: number; blocked: number; source: 'plan' | 'tasks' }

export type FleetSession = {
  id: string
  name: string
  role: FleetRole
  activity: FleetActivity
  reason?: string
  repo?: string
  branch?: string
  phase?: string
  cwd: string
  updatedAt: number
  ended?: boolean
  unmanaged?: boolean
  progress?: FleetProgress
  context?: number
}

export type FleetSelf = {
  name?: string
  role?: FleetRole
  activity: FleetActivity
  reason?: string
}

declare module 'claude-code' {
  interface PluginState {
    'bdb-aos-fleet': {
      fleet: FleetSession[]
      self: FleetSelf
      frame: number
    }
  }
}
