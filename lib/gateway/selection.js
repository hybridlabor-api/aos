'use strict';
// Gateway server selection: which shipped MCP servers the 1mcp gateway actually runs and exposes.
// The user's choice lives in ~/.aos/v5-settings.json as `gateway.servers` (array of server names);
// nothing here encodes fixed paths or accounts. Seeded by the installer from tier/module choices,
// re-derived by aos update and adjusted with `aos-gateway add/remove`. Adopted servers (user's own
// MCPs) are handled separately in lib/gateway/config.js and are never filtered here.
const fs = require('fs');
const path = require('path');
const { GATEWAY_SERVERS } = require('./config');

// Base set every install gets. Pro MEDIA adds the media/show-control servers, the Creator Extension
// module adds the creative-suite servers (only those whose app is present, see detectCreatorServers);
// `desktop` (computer-use, remote OS) is opt-in via `aos-gateway add`. Together the groups cover GATEWAY_SERVERS exactly.
// codebase_memory_mcp is gated by its own app pick (mcp_picks.json), so listing it in base is harmless.
const SERVER_GROUPS = Object.freeze({
    base: Object.freeze(['memb_mcp', 'deja', 'chrome-devtools', 'github', 'codebase_memory_mcp']),
    desktop: Object.freeze(['zavora_computer_use', 'bdb_windows_computer_use', 'bdb_remoteos_mcp']),
    media: Object.freeze(['bdb_grandma3_mcp', 'bdb_resolume_mcp', 'bdb_td_backup', 'bdb_unreal_mcp']),
    creator: Object.freeze(['bdb_after_effects_mcp', 'adobe_uxp_mcp', 'bdb_davinci_mcp', 'bdb_blender_mcp', 'open_design_mcp']),
});

// Pro MEDIA is recorded by the installer as tier '1' in the manifest.
function mediaTier(home) {
    try { return String(JSON.parse(fs.readFileSync(path.join(home, '.agents', '.bdb-manifest.json'), 'utf8')).tier) === '1'; } catch { return false; }
}

const NAME_OK = /^[A-Za-z0-9_-]+$/;
const union = (...sets) => [...new Set(sets.filter(Array.isArray).flat())];
const onlyKnown = (names) => union(names).filter((n) => GATEWAY_SERVERS.includes(n));

// Creator servers whose backing app is installed (fs-only probes, never a spawn). Blender reuses
// lib/mcp-pick.js detectApps; Adobe and DaVinci use their standard install locations.
function detectCreatorServers({ platform = process.platform, env = process.env, home, fsImpl = fs } = {}) {
    const out = [];
    const ls = (d) => { try { return fsImpl.readdirSync(d).map(String); } catch { return []; } };
    const has = (p) => { try { return fsImpl.existsSync(p); } catch { return false; } };
    let adobe = [];
    let davinci = false;
    if (platform === 'darwin') {
        adobe = ls('/Applications').filter((e) => /^Adobe (After Effects|Photoshop|Premiere|Illustrator)/.test(e));
        davinci = has('/Applications/DaVinci Resolve');
    } else if (platform === 'win32') {
        const pf = (env && env.ProgramFiles) || 'C:\\Program Files';
        adobe = ls(path.win32.join(pf, 'Adobe')).filter((e) => /^Adobe (After Effects|Photoshop|Premiere|Illustrator)/.test(e));
        davinci = has(path.win32.join(pf, 'Blackmagic Design', 'DaVinci Resolve'));
    } else davinci = has('/opt/resolve');
    if (require('../mcp-pick').detectApps({ platform, env, fsImpl, home })('blender')) out.push('bdb_blender_mcp');
    if (adobe.some((e) => /After Effects/.test(e))) out.push('bdb_after_effects_mcp');
    if (adobe.length) out.push('adobe_uxp_mcp');
    if (davinci) out.push('bdb_davinci_mcp');
    return out;
}

// Tier/module -> names. Base always; `media` for Pro MEDIA; `creator` = true (whole group) or the array of
// creator servers whose app was detected; `desktop` opts into the computer-use group.
function deriveGatewayServers({ media = false, creator = false, desktop = false, keep = [] } = {}) {
    return union(
        SERVER_GROUPS.base,
        ...(media ? [SERVER_GROUPS.media] : []),
        ...(creator === true ? [SERVER_GROUPS.creator] : Array.isArray(creator) ? [creator] : []),
        ...(desktop ? [SERVER_GROUPS.desktop] : []),
        onlyKnown(keep),
    );
}

// A stored array is a real selection: [] means "run no shipped server" (the user removed the last one) and is
// never re-derived. A non-empty array with no valid known name is corrupt and falls back to derivation.
function validStoredServers(v) {
    if (!Array.isArray(v)) return null;
    if (!v.length) return [];
    const ok = onlyKnown(v.filter((n) => NAME_OK.test(n)));
    return ok.length ? ok : null;
}

// Resolve the servers the gateway should run.
// - settingServers: settings.gateway.servers (the stored choice wins when valid);
// - keep: names evidence says the user already runs (current gateway upstreams, still direct in harness
//   configs); used ONLY on the first migration, when no selection was ever stored. Once a selection exists
//   it is the whole truth: a deselected server is not re-added from what currently runs;
// - media/creator/desktop: the tier/module adds, applied only when no stored choice exists.
// Returns { servers, fromSetting, kept } — kept = the keep names that were added on this first migration.
function resolveGatewayServers({ settingServers, media = false, creator = false, desktop = false, keep = [] } = {}) {
    const stored = validStoredServers(settingServers);
    if (stored) return { servers: stored, fromSetting: true, kept: [] };
    const servers = deriveGatewayServers({ media, creator, desktop, keep });
    const derived = deriveGatewayServers({ media, creator, desktop });
    return { servers, fromSetting: false, kept: servers.filter((n) => !derived.includes(n)) };
}

// Change ONE server: `aos-gateway add|remove <name>`. Updates the stored selection (seeding it from
// what runs today when the setting was absent), rewrites the gateway mcp.json and passes `restart`
// a callback the caller fills with its own service manager (launchctl/systemd/schtasks). Built on the
// same pure pieces as pkg-gateway.apply, so no reinstall happens. Lazy lib requires: profile.js sits
// behind installer-user packages and would recurse into this module through pkg-gateway.
function applyServerChange({ home, aosRoot, add: addName, remove: removeName, restart, platform = 'darwin', nodePath, env = {}, dryRun = false, log = () => {} }) {
    const fs = require('fs');
    const path = require('path');
    const cfg = require('./config');
    const { shippedPicks, launcherPath } = require('../mcp-secrets');
    const profile = require('../v5/profile');
    const names = [addName, removeName].filter((x) => typeof x === 'string');
    if (names.length !== 1 || !GATEWAY_SERVERS.includes(names[0])) {
        throw new Error(`exactly one gateway server name expected (one of: ${GATEWAY_SERVERS.join(', ')})`);
    }
    const server = names[0];
    const dir = cfg.gatewayDir(home);
    if (!fs.existsSync(path.join(dir, 'token'))) throw new Error('gateway is not installed (run the gateway install first)');
    const st = profile.readSettings(home, () => {});
    // keep = evidence of what the user runs today; an absent setting is seeded from it, not from a guess.
    let adopted = [], keep = [];
    try { keep = currentUpstreamNames(dir); } catch { /* no mcp.json yet */ }
    try { adopted = Object.keys(cfg.readAdopted(home)); } catch { /* no adopted.json yet */ }
    const r = resolveGatewayServers({ settingServers: st.gateway && st.gateway.servers, keep, media: mediaTier(home), creator: detectCreatorServers({ platform, env: process.env, home }) });
    let servers = r.servers;
    const changed = addName ? !servers.includes(server) : servers.includes(server);
    servers = addName ? union(servers, [server]) : servers.filter((n) => n !== server);
    const stNext = { ...profile.readSettings(home, () => {}), gateway: { ...(st.gateway || {}), servers } };
    log(`gateway servers: ${servers.join(', ') || 'none'} (was: ${r.servers.join(', ') || 'none'})`);
    let wrote = null;
    if (!dryRun) {
        const shipped = shippedPicks(aosRoot, { platform, env }).servers;
        const pm = require('../v5/pkg-gateway');
        const picked = (pm && pm.withoutMemory) ? pm.withoutMemory(shipped, home) : shipped;
        const upstreams = cfg.buildUpstreams({
            shipped: picked, selected: servers, home,
            launcher: launcherPath(home),
            pathEnv: cfg.defaultPathEnv({ home, nodePath: nodePath || process.execPath, platform }),
        });
        // mcp.json first, then the setting; a failed settings write restores the previous mcp.json.
        const mcpFile = path.join(dir, 'mcp.json');
        let prev = null;
        try { prev = fs.readFileSync(mcpFile, 'utf8'); } catch { /* none yet */ }
        wrote = cfg.writeGatewayConfig(dir, upstreams);
        try { profile.writeSettings(home, stNext); } catch (e) {
            if (prev !== null) fs.writeFileSync(mcpFile, prev, { mode: 0o600 });
            throw e;
        }
    }
    return { server, selected: servers, changedSetting: changed, wrote, dryRun, wasFromSetting: r.fromSetting };
}

// Shipped gateway upstreams of the live mcp.json (buildUpstreams tags every one with its own name; adopted too —
// filter by the stored-selection validity so adopted/user servers are not mistaken for the selection seed).
function currentUpstreamNames(dir) {
    const fs = require('fs');
    try {
        const cfg = JSON.parse(fs.readFileSync(require('path').join(dir, 'mcp.json'), 'utf8'));
        return Object.entries(cfg.mcpServers || {})
            .filter(([n, e]) => e && typeof e === 'object' && Array.isArray(e.tags) && e.tags.includes(n) && GATEWAY_SERVERS.includes(n))
            .map(([n]) => n);
    } catch { return []; }
}

module.exports = { SERVER_GROUPS, mediaTier, deriveGatewayServers, detectCreatorServers, validStoredServers, resolveGatewayServers, applyServerChange, currentUpstreamNames };
