'use strict';
// Doctor checks for the gateway, in aos-doctor's add() shape. Wired in by the aos orchestrator, not here.
const fs = require('fs');
const path = require('path');
const { gatewayDir, GATEWAY_PORT, GATEWAY_SERVERS, AE_MIN_NODE, nodeMajorOnPath, defaultPathEnv, alternatesOf, readAdopted } = require('./config');
const { isAosOwned, parseCodexTables, inlineSecrets } = require('../mcp-secrets');
const { scanAdoptable } = require('./adopt');
const { SUPPORTED, classify, mapOf, load, isAosShaped, tomlHasGateway, migrationPath } = require('./harness');

const LABEL = 'com.bdb.aos.gateway';
const COVERED = [...GATEWAY_SERVERS, ...GATEWAY_SERVERS.flatMap(alternatesOf)];

// AOS-owned direct entries of gateway-covered servers (alternates included) plus every adopted server still
// configured directly, in one server map. Without `shipped` every covered name counts.
function dupesInMap(map, kind, shipped, adopted = []) {
    const flat = (e) => (kind === 'opencode' ? { command: (e.command || [])[0], args: (e.command || []).slice(1) } : e);
    const owned = COVERED.filter((n) => map[n] !== undefined && (!shipped || isAosOwned(n, flat(map[n]), shipped[n], shipped)));
    return [...new Set([...owned, ...adopted.filter((n) => map[n] !== undefined)])];
}

// One row per harness file that points at the gateway: { file, kind, hasAos, dupes: [{ name, project? }], unread: [name] }.
// unread = covered TOML tables that stay direct because aos-gateway cannot read them (unparsed or inline secrets).
// Covers Claude's per-project mcpServers blocks and Codex TOML; files without the gateway entry report hasAos false.
function gatewayFiles({ files = [], shipped, adopted = [] }) {
    const rows = [];
    for (const { file, kind: hint } of files) {
        const kind = classify(file, hint);
        if (kind === 'codex') {
            let text;
            try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
            const hasAos = tomlHasGateway(text);
            const parsed = parseCodexTables(text);
            const map = {};
            for (const [n, t] of Object.entries(parsed)) map[n] = { command: t.fields.command, args: Array.isArray(t.fields.args) ? t.fields.args : [] };
            const unread = hasAos ? COVERED.filter((n) => parsed[n] && (parsed[n].unparsed.length || inlineSecrets(parsed[n].env).length)) : [];
            rows.push({ file, kind, hasAos, dupes: hasAos ? dupesInMap(map, kind, shipped, adopted).map((name) => ({ name })) : [], unread });
            continue;
        }
        if (!SUPPORTED.has(kind)) continue;
        let loaded;
        try { loaded = load(file); } catch { continue; }
        if (!loaded || loaded.bad) continue;
        const map = mapOf(loaded.data, kind);
        if (!map) continue;
        const hasAos = isAosShaped(map.aos);
        const dupes = [];
        if (hasAos) {
            dupesInMap(map, kind, shipped, adopted).forEach((name) => dupes.push({ name }));
            const projects = kind === 'claude' && loaded.data.projects && typeof loaded.data.projects === 'object' ? loaded.data.projects : {};
            for (const [project, p] of Object.entries(projects)) {
                const pm = p && typeof p === 'object' && p.mcpServers && typeof p.mcpServers === 'object' && !Array.isArray(p.mcpServers) ? p.mcpServers : null;
                if (pm) dupesInMap(pm, kind, shipped, adopted).forEach((name) => dupes.push({ name, project }));
            }
        }
        rows.push({ file, kind, hasAos, dupes, unread: [] });
    }
    return rows;
}
const dupeLabel = (d) => (d.project ? `${d.name} (project ${d.project})` : d.name);

// status = result of gatewayStatus() when the caller has it; shipped enables the "still direct" ownership test.
function gatewayChecks({ home, files = [], status, shipped, platform = process.platform, nodeMajor }) {
    const dir = gatewayDir(home);
    const tokenFile = path.join(dir, 'token');
    const plist = path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
    const installed = fs.existsSync(tokenFile) || fs.existsSync(plist) || fs.existsSync(path.join(dir, 'mcp.json'));
    const out = [];
    const add = (name, ok, detail, fix, warningOnly = false) => out.push({ area: 'gateway', name, ok, detail, fix: ok ? '' : fix, warningOnly: warningOnly || !installed });

    if (platform === 'darwin') {
        let txt = '';
        try { txt = fs.readFileSync(plist, 'utf8'); } catch { /* missing: reported below */ }
        if (/\.nvm|\.fnm|fnm_multishells|\.volta|\.asdf/.test(txt)) add('gateway node path', false, 'service pins a version-manager node path', 'a node upgrade removes it; re-run the gateway install (aos → Settings → MCP gateway) after upgrading node', true);
    }
    if (platform === 'darwin') add('gateway service', fs.existsSync(plist), plist, 'install the gateway (aos → Settings → MCP gateway)');
    if (status) add('gateway running', status.running === true && status.port === GATEWAY_PORT, status.running ? `port ${status.port}` : (status.error || 'not running'), 'aos-gateway restart; see ~/.agents/gateway/gateway.log');

    let tokenOk = false;
    let tokenMissing = true;
    let tokenDetail = `${tokenFile} missing`;
    try {
        const m = fs.statSync(tokenFile).mode & 0o777;
        tokenMissing = false;
        tokenOk = platform === 'win32' || (m & 0o077) === 0;
        tokenDetail = platform === 'win32' ? tokenFile : `mode ${m.toString(8)}`;
    } catch { /* missing */ }
    add('gateway token', tokenOk, tokenDetail, tokenMissing ? 'install the gateway (aos → Settings → MCP gateway)' : `chmod 600 ${tokenFile}`);

    // After Effects (mcp-aftereffects) needs Node >= 24 on the upstream PATH: a warning only, never a failure.
    try {
        const major = nodeMajor !== undefined ? nodeMajor : nodeMajorOnPath(defaultPathEnv({ home, nodePath: process.execPath, platform }));
        add('gateway node for after effects', major !== null && major >= AE_MIN_NODE, major === null ? 'no node found on the upstream PATH' : `node ${major}`,
            `@kumoproductions/mcp-aftereffects needs Node >= ${AE_MIN_NODE}: upgrade node, then re-run the gateway install (aos → Settings → MCP gateway)`, true);
    } catch { /* never block the other checks */ }

    let adopted = [];
    try { adopted = Object.keys(readAdopted(home)); } catch { /* unreadable adopted.json: no adopted names to compare */ }
    let anyAos = false;
    for (const row of gatewayFiles({ files, shipped, adopted })) {
        anyAos = anyAos || row.hasAos;
        add(`gateway entry in ${row.file}`, row.hasAos, row.hasAos ? 'aos entry present' : 'no AOS-shaped "aos" entry', 'aos-gateway enable');
        if (row.hasAos) add(`gateway duplicates in ${row.file}`, row.dupes.length === 0, row.dupes.length ? `also direct: ${row.dupes.map(dupeLabel).join(', ')}` : 'none', 'aos-gateway enable (gateway servers) or aos-gateway adopt (adopted servers)');
        if (row.hasAos) add(`gateway tables not verified in ${row.file}`, row.unread.length === 0, row.unread.length ? `kept direct, aos-gateway cannot read them: ${row.unread.join(', ')}` : 'none', 'simplify the table (plain values, no inline secrets) so aos-gateway can read it, then aos-gateway enable');
    }
    if (anyAos) add('gateway migration record', fs.existsSync(migrationPath(home)), migrationPath(home), 'without it "aos-gateway direct" cannot restore the original entries; restore from the *.aos-gateway-bak-* backups');

    try {
        const scan = scanAdoptable({ files, shipped });
        const names = scan.adoptable.map((a) => a.name);
        const shown = names.length > 5 ? `${names.slice(0, 5).join(', ')}...` : names.join(', ');
        add('gateway adoptable MCPs', names.length === 0,
            names.length ? `${names.length} local MCP(s) run next to the gateway: ${shown}` : 'none',
            'run: aos-gateway adopt (preview with --dry-run)', true);
    } catch { /* never block the doctor on a scan failure */ }

    let leftovers = [];
    try { leftovers = fs.readdirSync(dir).filter((n) => /^node_modules\.removed-/.test(n)); } catch { /* no dir */ }
    for (const n of leftovers) {
        const p = path.join(dir, n);
        add(`leftover ${n}`, false, p, `delete manually once nothing needs it: rm -r ${p}`, true);
    }
    return out;
}

module.exports = { gatewayChecks, gatewayFiles, dupeLabel };
