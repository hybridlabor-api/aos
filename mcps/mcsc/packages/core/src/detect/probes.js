import { execFile } from 'node:child_process';
import { stat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} options
 * @returns {Promise<{stdout: string, stderr: string, error: any}>}
 */
const runExecFile = (cmd, args, options) => {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr, error });
    });
  });
};

/** @param {string} path */
const statPath = (path) => stat(path).then((s) => ({ mtime: s.mtimeMs }));

/** @param {string} path */
const readFilePath = (path) => readFile(path, 'utf8');

/**
 * @param {{execFile: (cmd: string, args: string[], options?: object) => Promise<any>,
 *           stat: (path: string) => Promise<{mtime: number}>,
 *           readFile: (path: string) => Promise<string>}} sh
 * @returns {Promise<{pass: boolean, evidence?: string, reason?: string}>}
 */
const binaryResolvable = async (sh) => {
  const binaryMap = { agy: 'agy', opencode: 'opencode', codex: 'codex' };
  const name = binaryMap[sh.cliId];
  if (!name) return { pass: false, reason: 'unknown-cli' };
  try {
    const which = await runExecFile('which', [name], {});
    const resolvedPath = which.stdout.trim();
    // realpath does no PATH lookup of its own — it needs the actual path
    // `which` just resolved, not the bare command name.
    await runExecFile('realpath', [resolvedPath], {});
    return { pass: true };
  } catch {
    return { pass: false, evidence: `binary '${name}' not resolvable`, reason: 'not-on-path' };
  }
};

/**
 * @param {{execFile: (cmd: string, args: string[], options?: object) => Promise<any>,
 *           readFile: (path: string) => Promise<string>}} sh
 * @returns {Promise<{pass: boolean, evidence?: string, reason?: string}>}
 */
const authLive = async (sh) => {
  try {
    if (sh.cliId === 'agy') {
      await runExecFile('agy', ['models'], { timeout: 15000 });
      return { pass: true };
    }
    if (sh.cliId === 'opencode') {
      await runExecFile('opencode', ['models'], { timeout: 15000 });
      return { pass: true };
    }
    if (sh.cliId === 'codex') {
      await runExecFile('codex', ['models'], { timeout: 15000 });
      return { pass: true };
    }
    return { pass: false, evidence: 'no auth command for this CLI', reason: 'unauthenticated' };
  } catch (e) {
    return { pass: false, evidence: e.message, reason: 'unauthenticated' };
  }
};

/**
 * @param {{execFile: (cmd: string, args: string[], options?: object) => Promise<any>,
 *           stat: (path: string) => Promise<{mtime: number}>,
 *           readFile: (path: string) => Promise<string>}} sh
 * @returns {Promise<{pass: boolean, evidence?: string, reason?: string}>}
 */
const opencodeFsOwnership = async (sh) => {
  const configDirs = [
    join(homedir(), '.config', 'opencode'),
    join(homedir(), '.cache', 'opencode'),
    join(homedir(), '.local', 'state', 'opencode'),
    join(homedir(), '.local', 'share', 'opencode'),
  ];
  for (const dir of configDirs) {
    try {
      await statPath(dir);
    } catch {
      return { pass: false, evidence: `config dir '${dir}' not accessible`, reason: 'permissions' };
    }
  }
  return { pass: true };
};

/**
 * @param {{execFile: (cmd: string, args: string[], options?: object) => Promise<any>,
 *           readFile: (path: string) => Promise<string>}} sh
 * @returns {Promise<{pass: boolean, evidence?: string, reason?: string}>}
 */
const agyMcpHeadlessLatency = async (sh) => {
  const start = Date.now();
  try {
    await runExecFile('agy', ['--print-timeout', '20s', '-p', 'OK'], {});
    const duration = Date.now() - start;
    if (duration > 20000) {
      return { pass: false, evidence: `latency ${duration}ms exceeds 20s budget`, reason: 'degrade' };
    }
    return { pass: true };
  } catch (e) {
    return { pass: false, evidence: e.message, reason: 'degrade' };
  }
};

/**
 * @param {{execFile: (cmd: string, args: string[], options?: object) => Promise<any>,
 *           readFile: (path: string) => Promise<string>}} sh
 * @returns {Promise<{pass: boolean, evidence?: string, reason?: string}>}
 */
const tierFreshness = async (sh) => {
  try {
    if (sh.cliId === 'opencode') {
      await runExecFile('opencode', ['models'], { timeout: 15000 });
      return { pass: true };
    }
    if (sh.cliId === 'agy') {
      await runExecFile('agy', ['models'], { timeout: 15000 });
      return { pass: true };
    }
    if (sh.cliId === 'codex') {
      await runExecFile('codex', ['models'], { timeout: 15000 });
      return { pass: true };
    }
    return { pass: true };
  } catch (e) {
    return { pass: false, evidence: e.message, reason: 'stale-tier' };
  }
};

/**
 * @type {Probe[]}
 */
export const probes = [
  { id: 'agy.binary.resolvable', cliId: 'agy', severity: 'fatal', timeoutMs: 10000, run: binaryResolvable, remedy: { human: 'Install agy via npm/brew', command: 'which agy', autoFixable: true } },
  { id: 'opencode.binary.resolvable', cliId: 'opencode', severity: 'fatal', timeoutMs: 10000, run: binaryResolvable, remedy: { human: 'Install opencode via npm', command: 'which opencode', autoFixable: true } },
  { id: 'codex.binary.resolvable', cliId: 'codex', severity: 'fatal', timeoutMs: 10000, run: binaryResolvable, remedy: { human: 'Install codex CLI', command: 'which codex', autoFixable: true } },
  { id: 'agy.auth.live', cliId: 'agy', severity: 'fatal', timeoutMs: 15000, run: authLive, remedy: { human: 'Re-authenticate agy', command: 'agy login', autoFixable: false } },
  { id: 'opencode.auth.live', cliId: 'opencode', severity: 'fatal', timeoutMs: 15000, run: authLive, remedy: { human: 'Re-authenticate opencode', command: 'opencode login', autoFixable: false } },
  { id: 'codex.auth.live', cliId: 'codex', severity: 'fatal', timeoutMs: 15000, run: authLive, remedy: { human: 'Authenticate codex', command: 'codex login', autoFixable: false } },
  { id: 'opencode.fs.ownership', cliId: 'opencode', severity: 'fatal', timeoutMs: 10000, run: opencodeFsOwnership, remedy: { human: 'Fix opencode config dir ownership', command: 'chown -R $(whoami):staff ~/.config/opencode', autoFixable: true } },
  { id: 'agy.mcp.headless-latency', cliId: 'agy', severity: 'degrade', timeoutMs: 20000, run: agyMcpHeadlessLatency, remedy: { human: 'Investigate MCP server connectivity', command: 'agy mcp list', autoFixable: false } },
  { id: 'opencode.tier.freshness', cliId: 'opencode', severity: 'degrade', timeoutMs: 15000, run: tierFreshness, remedy: { human: 'Refresh opencode model list', command: 'opencode models', autoFixable: false } },
  { id: 'agy.tier.freshness', cliId: 'agy', severity: 'degrade', timeoutMs: 15000, run: tierFreshness, remedy: { human: 'Refresh agy model list', command: 'agy models', autoFixable: false } },
  { id: 'codex.tier.freshness', cliId: 'codex', severity: 'degrade', timeoutMs: 15000, run: tierFreshness, remedy: { human: 'Refresh codex model list', command: 'codex models', autoFixable: false } },
];

export default probes;