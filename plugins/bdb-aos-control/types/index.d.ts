export type ControlTab = 'fleet' | 'pipeline' | 'git' | 'control'

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

export type PipelineFinding = {
  id: string
  severity: 'blocking' | 'advisory'
  node: string
  status: 'open' | 'fixed' | 'wont_fix'
  summary?: string
}

export type PipelineGate = Record<string, 'pass' | 'fail' | 'skip'>

export type PipelineState = {
  run_id: string
  goal: string
  phase: 'define' | 'plan' | 'build' | 'verify' | 'review' | 'ready_to_ship' | 'ship' | 'done' | 'escalated'
  iteration: number
  max_iterations: number
  gate: PipelineGate
  findings: PipelineFinding[]
  approvals: Array<{ node: string; token: string; at: string }>
  needs_human?: boolean
  artifacts?: Record<string, string | null>
}

export type GitStage = 'editing' | 'committed' | 'reviewed' | 'merged'

export type GitWorktreeItem = {
  path: string
  branch: string
  head: string
  stage: GitStage
  dirtyCount: number
  aheadCount: number
  behindCount: number
  isAgentWorktree: boolean
  agentName?: string
  findingsOpen?: number
  findingsTotal?: number
}

export type GateProfile = {
  profile: 'strict' | 'work' | 'off'
  minutesLeft: number | null
  note?: string
}

export type GateState = {
  mode: string
  grants: { scope: string; minutesLeft: number }[]
  raw: string
}

export type ContextProfile = {
  name: string
  estimate?: string
}

export type ServiceStatus = {
  id: string
  name: string
  status: 'running' | 'down' | 'unknown'
  port?: number
}

declare module 'claude-code' {
  interface PluginState {
    'bdb-aos-control': {
      tab: ControlTab
      fleet: FleetSession[]
      pipeline: PipelineState | null
      gitWorktrees: GitWorktreeItem[]
      profile: GateProfile | null
      gate: GateState | null
      contextProfile: ContextProfile | null
      services: ServiceStatus[]
      message: string
      frame: number
    }
  }
}
