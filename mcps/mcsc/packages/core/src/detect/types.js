/**
 * @typedef {'agy'|'opencode'|'codex'|'native'} CliId
 */

/**
 * @typedef {{pass: boolean, evidence?: string, reason?: string}} ProbeResult
 */

/**
 * @typedef {{id: string, cliId: CliId, severity: 'fatal'|'degrade'|'info', timeoutMs: number,
 *   run: (sh: {execFile: (cmd: string, args: string[], options?: object) => Promise<any>,
 *            fs: {stat: (path: string) => Promise<{mtime: number}>,
 *                   readFile: (path: string) => Promise<string>}), ProbeResult,
 *   remedy: {human: string, command?: string, autoFixable: boolean}}} Probe
 */

/**
 * @typedef {{status: 'ready'|'degraded'|'unusable'|'absent', binary: string, version: string, probes: ProbeResult[]}} CliHealth.ready
 * @typedef {{status: 'unusable', reason: 'not-on-path'|'unauthenticated'|'permissions'|'hangs'|'version-unsupported', probes: ProbeResult[]}} CliHealth.unusable
 * @typedef {{status: 'absent'}} CliHealth.absent
 * @typedef {CliHealth.ready | CliHealth.unusable | CliHealth.absent} CliHealth
 */

// These are JSDoc-only typedefs — nothing to export at runtime. Other files
// reference them via `@typedef {import('./types.js').CliHealth} CliHealth`.
export {};