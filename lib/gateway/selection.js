'use strict';
// Gateway server selection: which shipped MCP servers the 1mcp gateway actually runs and exposes.
// The user's choice lives in ~/.aos/v5-settings.json as `gateway.servers` (array of server names);
// nothing here encodes fixed paths or accounts. Seeded by the installer from tier/module choices,
// re-derived by aos update and adjusted with `aos-gateway add/remove`. Adopted servers (user's own
// MCPs) are handled separately in lib/gateway/config.js and are never filtered here.
const { GATEWAY_SERVERS } = require('./config');

// Base set every install gets. Pro MEDIA adds the media/show-control servers, the Creator Extension
// module adds the creative-suite servers; together with base they cover GATEWAY_SERVERS exactly.
const SERVER_GROUPS = Object.freeze({
    base: Object.freeze(['memb_mcp', 'deja', 'chrome-devtools', 'github']),
    media: Object.freeze(['bdb_grandma3_mcp', 'bdb_resolume_mcp', 'bdb_td_backup', 'bdb_unreal_mcp']),
    creator: Object.freeze(['bdb_after_effects_mcp', 'adobe_uxp_mcp', 'bdb_davinci_mcp', 'bdb_blender_mcp', 'open_design_mcp']),
});

const NAME_OK = /^[A-Za-z0-9_-]+$/;
const union = (...sets) => [...new Set(sets.filter(Array.isArray).flat())];
const onlyKnown = (names) => union(names).filter((n) => GATEWAY_SERVERS.includes(n));

// Tier/module -> names. Base always; `media` for Pro MEDIA; `creator` for the Creator Extension module.
function deriveGatewayServers({ media = false, creator = false, keep = [] } = {}) {
    return union(
        SERVER_GROUPS.base,
        ...(media ? [SERVER_GROUPS.media] : []),
        ...(creator ? [SERVER_GROUPS.creator] : []),
        onlyKnown(keep),
    );
}

// A stored array is valid when it is a non-empty array of syntactically valid names (clamped to known
// gateway servers). Empty arrays fall back to derivation so a bad write can never blackhole the gateway.
function validStoredServers(v) {
    if (!Array.isArray(v) || !v.length) return null;
    const ok = onlyKnown(v.filter((n) => NAME_OK.test(n)));
    return ok.length ? ok : null;
}

// Resolve the servers the gateway should run.
// - settingServers: settings.gateway.servers (the stored choice wins when valid);
// - keep: names evidence says the user already runs (current gateway upstreams, adopted-seen, still
//   direct in harness configs) — never silently dropped;
// - media/creator: the tier/module adds, applied only when no stored choice exists.
// Era: { servers, fromSetting } — fromSetting=true means the user (or installer) made an explicit list
// and derivation (media/creator) does not apply; keep is still unioned in so nothing in use is dropped.
function resolveGatewayServers({ settingServers, media = false, creator = false, keep = [] } = {}) {
    const stored = validStoredServers(settingServers);
    const servers = stored ? union(stored, onlyKnown(keep)) : deriveGatewayServers({ media, creator, keep });
    return { servers, fromSetting: !!stored };
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
    const r = resolveGatewayServers({ settingServers: st.gateway && st.gateway.servers, keep, creator: !(st.disabled && st.disabled.includes('creator')) });
    let servers = r.servers;
    const changed = addName ? !servers.includes(server) : servers.includes(server);
    servers = addName ? union(servers, [server]) : servers.filter((n) => n !== server);
    const stNext = { ...profile.readSettings(home, () => {}), gateway: { ...(st.gateway || {}), servers } };
    if (!dryRun) profile.writeSettings(home, stNext);
    log(`gateway servers: ${servers.join(', ')} (was: ${r.servers.join(', ') || 'none'})`);
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
        wrote = cfg.writeGatewayConfig(dir, upstreams);
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

module.exports = { SERVER_GROUPS, deriveGatewayServers, validStoredServers, resolveGatewayServers, applyServerChange, currentUpstreamNames };
