export type InstallProfileName = 'minimal' | 'standard' | 'full'
export type ContextProfileName = 'full' | 'orchestrator' | 'worker' | 'small'

export declare const INSTALL_PROFILES: InstallProfileName[]
export declare const CONTEXT_PROFILES: Record<ContextProfileName, { label: string; estimate: number }>
export declare const DEFAULT_CONTEXT_PROFILE: ContextProfileName

export declare function knownContextProfile(x: unknown): x is ContextProfileName
export declare function sanitizeContext(raw: unknown): ContextProfileName
export declare function parseSettings(text: string | undefined | null): { installProfile: InstallProfileName; contextProfile: ContextProfileName }
export declare function readInstallProfile(home: string): InstallProfileName
export declare function readContextProfile(home: string): ContextProfileName
export declare function statusLine(home: string): string
export declare function tokenEstimate(name: string): string
export declare function roleHint(sessionName?: string): string
