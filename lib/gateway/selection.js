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

module.exports = { SERVER_GROUPS, deriveGatewayServers, validStoredServers, resolveGatewayServers };
