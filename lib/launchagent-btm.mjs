// macOS Background Task Management (BTM) probe, read-only (audit P0-3): a com.bdb.*
// LaunchAgent whose plist is installed but that launchd does not run after login is
// almost always a "Login Items → Allow in the Background" revocation. Never calls
// sfltool and never loads anything: the only command is `launchctl print
// gui/<uid>/<label>`, which merely reads the agent's launchd state.
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const PLIST_PREFIX = /^com\.bdb\..+\.plist$/;
const guiTarget = (label) => {
  return `gui/${process.getuid?.() ?? 0}/${label}`;
};

export const btmFixHint = (label) =>
  `System Settings > General > Login Items, section "Allow in the Background": allow ${label} there — macOS blocked it at login, \`launchctl load\` cannot lift that`;

// The installed com.bdb.* LaunchAgents (~ absolute plists). Empty list on other platforms
// or when LaunchAgents does not exist.
export function launchAgentPlists(home) {
  const dir = join(home, 'Library', 'LaunchAgents');
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((f) => PLIST_PREFIX.test(f)).map((f) => join(dir, f));
}

// Loaded state of one label. 'yes' | 'no' | null (cannot answer: launchctl missing,
// timeout, or test sandbox without an override). run(cmd, args) must return {status}.
export function agentLoadStatus(label, { run } = {}) {
  const probe = run || ((cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000, windowsHide: true }));
  try {
    const r = probe('launchctl', ['print', guiTarget(label)]);
    if (!r || (r.status == null && !r.error)) return null;
    if (r.status === null && (r.error || r.signal)) return null;
    return r.status === 0 ? 'yes' : 'no';
  } catch { return null; }
}

// The com.bdb.* agents whose plist exists but whose label is not loaded after login,
// with the System Settings fix. Never answers under a test sandbox unless a run
// override (opts.run) is given — doctor tests mock launchctl there.
export function btmNotLoadedAgents(home, opts = {}) {
  if (process.env.AOS_TEST_SANDBOX && typeof opts.run !== 'function') return [];
  return launchAgentPlists(opts.home || home)
    .map((plist) => ({ plist, label: basename(plist).replace(/\.plist$/, '') }))
    .filter((d) => agentLoadStatus(d.label, opts) === 'no')
    .map((d) => ({ ...d, label: d.label, fix: btmFixHint(d.label) }));
}
