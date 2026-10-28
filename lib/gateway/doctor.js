'use strict';
// Doctor checks for the gateway, in aos-doctor's add() shape. Wired in by the aos orchestrator, not here.
const fs = require('fs');
const path = require('path');
const { gatewayDir, GATEWAY_PORT, GATEWAY_SERVERS, DIRECT_SERVERS, AE_MIN_NODE, nodeMajorOnPath, defaultPathEnv, alternatesOf, readAdopted } = require('./config');
const { isAosOwned, parseCodexTables, inlineSecrets } = require('../mcp-secrets');
const { scanAdoptable } = require('./adopt');
const { parseJsonc } = require('../jsonc');
const { SUPPORTED, classify, mapOf, load, isAosShaped, tomlHasGateway, migrationPath } = require('./harness');
const HARNESS_ROWS = require('../harnesses.json');

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
        if (!loaded) continue;
        // OpenCode's opencode.jsonc may carry comments: aos-gateway never rewrites it, but the doctor can still read it.
        let data = loaded.data;
        let commented = false;
        if (loaded.bad) {
            if (kind !== 'opencode') continue;
            try { data = parseJsonc(loaded.text); commented = true; } catch { continue; }
            if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
        }
        const map = mapOf(data, kind);
        if (!map) continue;
        const hasAos = isAosShaped(map.aos);
        const dupes = [];
        if (hasAos) {
            dupesInMap(map, kind, shipped, adopted).forEach((name) => dupes.push({ name }));
            const projects = kind === 'claude' && data.projects && typeof data.projects === 'object' ? data.projects : {};
            for (const [project, p] of Object.entries(projects)) {
                const pm = p && typeof p === 'object' && p.mcpServers && typeof p.mcpServers === 'object' && !Array.isArray(p.mcpServers) ? p.mcpServers : null;
                if (pm) dupesInMap(pm, kind, shipped, adopted).forEach((name) => dupes.push({ name, project }));
            }
        }
        rows.push({ file, kind, hasAos, dupes, unread: [], ...(commented ? { commented } : {}) });
    }
    return rows;
}
const dupeLabel = (d) => (d.project ? `${d.name} (project ${d.project})` : d.name);

// Gateway-covered names configured DIRECT in harness files (alternates mapped back to their gateway
// name), regardless of whether the `aos` entry exists. Evidence for "never silently drop a server the
// user already uses": hasAos=false rows count too.
function directGatewayNames({ files = [], shipped, adopted = [] } = {}) {
    const canonical = (n) => {
        for (const gw of GATEWAY_SERVERS) if (n === gw || alternatesOf(gw).includes(n)) return gw;
        return null;
    };
    const out = new Set();
    for (const { file, kind: hint } of files) {
        const kind = classify(file, hint);
        if (kind === 'codex') {
            let text;
            try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
            for (const [n, t] of Object.entries(parseCodexTables(text))) {
                if (t.unparsed.length || inlineSecrets(t.env).length) continue;
                const gw = canonical(n);
                if (gw && isAosOwned(n, { command: t.fields.command, args: t.fields.args }, shipped && shipped[n], shipped)) out.add(gw);
            }
            continue;
        }
        if (!SUPPORTED.has(kind)) continue;
        let loaded;
        try { loaded = load(file); } catch { continue; }
        if (!loaded || loaded.bad) continue;
        const scan = (map, flatKind) => {
            if (!map) return;
            for (const [n, e] of Object.entries(map)) {
                const flat = flatKind === 'opencode' ? { command: (e.command || [])[0], args: (e.command || []).slice(1), env: e.env } : e;
                if (!flat || flat.url) continue;
                const gw = canonical(n);
                if (gw && isAosOwned(n, flat, shipped && shipped[n], shipped)) out.add(gw);
            }
        };
        scan(mapOf(loaded.data, kind), kind);
        if (kind === 'claude') {
            const projects = loaded.data.projects && typeof loaded.data.projects === 'object' ? loaded.data.projects : {};
            for (const p of Object.values(projects)) scan(p && p.mcpServers, kind);
        }
    }
    for (const n of adopted || []) if (canonical(n)) out.add(canonical(n));
    return [...out];
}

// status = result of gatewayStatus() when the caller has it; shipped enables the "still direct" ownership test.
function gatewayChecks({ home, files = [], status, shipped, platform = process.platform, nodeMajor, detectMediaServers: detectFnOverride }) {
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

    let selectedMedia = [];
    const selection = require('./selection');
    try {
        const profile = require('../v5/profile');
        const st = profile.readSettings(home, () => {});
        const stored = selection.validStoredServers(st.gateway && st.gateway.servers);
        if (stored) {
            selectedMedia = stored.filter((n) => selection.SERVER_GROUPS.media.includes(n));
        }
    } catch { /* ignore read failure */ }
    const detectFn = (typeof detectFnOverride === 'function') ? detectFnOverride : selection.detectMediaServers;
    const detectedMedia = detectFn({ platform, home, env: process.env });
    const missingMedia = selectedMedia.filter((n) => !detectedMedia.includes(n));

    for (const name of missingMedia) {
        add(`media server ${name}`, false, 'app not installed', `install the backing application, or remove with: aos-gateway remove ${name}`, true);
    }

    const degraded = status && status.running
        ? (status.upstreams || []).filter((u) => u.degraded && !missingMedia.includes(u.name))
        : [];
    if (degraded.length) add('gateway upstreams', false, `degraded: ${degraded.map((u) => `${u.name} (${u.error})`).join(', ')}`, 'those upstreams could not start (missing app or tool?); the rest of the gateway works', true);

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

    // Adoption removes the direct harness entries: an adopted name the gateway does not serve is a lost MCP.
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, 'adopted.json'), 'utf8'));
        const names = Object.keys((raw && raw.servers) || {});
        let served = [];
        try { served = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8')).mcpServers || {}); } catch { /* no config: nothing served */ }
        const lost = names.filter((n) => !served.includes(n));
        if (names.length) add('gateway adopted servers served', lost.length === 0,
            lost.length ? `adopted but not served by the gateway: ${lost.join(', ')}` : `${names.length} adopted server(s) served`,
            'aos-gateway restart (rewrites mcp.json); if still missing: aos-gateway direct to restore the original entries');
    } catch { /* no adopted.json: nothing adopted */ }

    let adopted = [];
    try { adopted = Object.keys(readAdopted(home)); } catch { /* unreadable adopted.json: no adopted names to compare */ }
    let anyAos = false;
    for (const row of gatewayFiles({ files, shipped, adopted })) {
        anyAos = anyAos || row.hasAos;
        add(`gateway entry in ${row.file}`, row.hasAos, row.hasAos ? 'aos entry present' : 'no AOS-shaped "aos" entry', 'aos-gateway enable');
        if (row.hasAos) add(`gateway duplicates in ${row.file}`, row.dupes.length === 0, row.dupes.length ? `also direct: ${row.dupes.map(dupeLabel).join(', ')}` : 'none', 'aos-gateway enable (gateway servers) or aos-gateway adopt (adopted servers)');
        if (row.hasAos && row.dupes.some((d) => DIRECT_SERVERS.includes(d.name))) add(`gateway direct by design in ${row.file}`, true, row.dupes.filter((d) => DIRECT_SERVERS.includes(d.name)).map(dupeLabel).join(', '), '');
        if (row.hasAos) add(`gateway tables not verified in ${row.file}`, row.unread.length === 0, row.unread.length ? `kept direct, aos-gateway cannot read them: ${row.unread.join(', ')}` : 'none', 'simplify the table (plain values, no inline secrets) so aos-gateway can read it, then aos-gateway enable');
    }
    // #181: the VS Code docs give the "servers" shape but no file path, so aos-gateway never rewrites it.
    for (const { file, kind: hint } of files) {
        if (classify(file, hint) === 'vscode' && fs.existsSync(file)) add(`gateway skips ${file}`, false, 'VS Code mcp.json is not managed: its location in the user profile is not documented, so the shape stays unverified; servers listed there stay direct', 'remove servers the gateway already serves from that file by hand (MCP: Open User Configuration)', true);
    }
    // One row for everything that breaks "one source of truth": direct copies next to the gateway, and gateway servers
    // that are neither selected nor adopted (listed by file + server / server name).
    try {
        const rows = gatewayFiles({ files, shipped, adopted });
        const dupes = rows.flatMap((r) => r.dupes.map((d) => `${r.file}: ${dupeLabel(d)}${r.commented ? ' (file has comments, remove by hand)' : ''}`));
        let stray = [];
        const stored = require('./selection').validStoredServers(require('../v5/profile').readSettings(home, () => {}).gateway?.servers);
        if (stored) {
            const served = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8')).mcpServers || {});
            stray = served.filter((n) => !stored.includes(n) && !adopted.includes(n));
        }
        add('gateway hygiene', dupes.length === 0 && stray.length === 0,
            [dupes.length ? `duplicates: ${dupes.join('; ')}` : '', stray.length ? `served but neither selected nor adopted: ${stray.join(', ')}` : ''].filter(Boolean).join(' | ') || 'no duplicates; mcp.json = selection + adopted',
            'aos-gateway enable removes duplicates (with backup); aos-gateway add|remove <name> fixes the selection');
    } catch { /* never block the other checks */ }
    add('not managed by the gateway (unverified)', true, HARNESS_ROWS.filter((h) => !h.verified).map((h) => h.id).join(', '), '');
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

// ~85 tokens per MCP tool (name + schema is heavier; this is a coarse estimate callers must label as an estimate).
const TOKENS_PER_TOOL = 85;

const SIZE_TOOL_LIMIT = 200;
const SIZE_NODE_LIMIT = 8000;
const SIZE_HINT = 'enable lazy loading in gateway.json, use harness presets, or trim servers with "aos-gateway remove <name>"';

// Approximate JSON node counter: counts container nodes, keys/properties, and value/primitive leaves.
function countJsonNodes(val) {
    if (val === null || typeof val !== 'object') return 1;
    let count = 1;
    if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) count += countJsonNodes(val[i]);
    } else {
        for (const [k, v] of Object.entries(val)) {
            count += 1 + countJsonNodes(v);
        }
    }
    return count;
}

// Live size and tool counts for the gateway: MCP handshake over streamable HTTP, tools/list, then
// measure tool count, approximate JSON AST node count, and bucket by server_1mcp_tool naming.
// Token is never stored or printed.
async function gatewaySizeMetrics({ port = GATEWAY_PORT, token, timeoutMs = 8000, fetchFn = globalThis.fetch } = {}) {
    if (!token) return { ok: false, toolCount: null, nodeCount: null, warning: null, error: 'no token' };
    const sanitize = (s) => (token ? String(s).split(token).join('[REDACTED]') : String(s));
    const headers = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'Authorization': `Bearer ${token}`,
        'x-aos-token': token,
    };
    try {
        const post = (body, extraHeaders = {}) => fetchFn(`http://127.0.0.1:${port}/mcp`, {
            method: 'POST',
            headers: { ...headers, ...extraHeaders },
            body: JSON.stringify(body),
            signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(timeoutMs) : undefined,
        });

        const read = (t) => { const m = /^data: (.*)$/m.exec(t); try { return JSON.parse(m ? m[1] : t); } catch { return null; } };
        const r = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
        if (!r) return { ok: false, toolCount: null, nodeCount: null, warning: null, error: 'HTTP offline' };
        let parsed = r.status === 200 ? read(await r.text()) : null;
        let failure = r.status === 200 ? null : `HTTP ${r.status}`;

        // Streamable HTTP servers answer a sessionless tools/list with 400 or a JSON-RPC error: do the handshake then.
        if (r.status !== 200 || (parsed && parsed.error && parsed.error.code)) {
            const initRes = await post({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'aos-doctor', version: '0' } } });
            if (initRes && initRes.status === 200) {
                await initRes.text();
                const sid = (initRes.headers && typeof initRes.headers.get === 'function') ? initRes.headers.get('mcp-session-id') : null;
                await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid ? { 'mcp-session-id': sid } : {});
                const listRes = await post({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }, sid ? { 'mcp-session-id': sid } : {});
                if (listRes.status !== 200) return { ok: false, toolCount: null, nodeCount: null, warning: null, error: `HTTP ${listRes.status} on tools/list after initialize` };
                parsed = read(await listRes.text());
            } else {
                return { ok: false, toolCount: null, nodeCount: null, warning: null, error: failure || `HTTP ${initRes ? initRes.status : 'offline'} on initialize` };
            }
        }

        const tools = (parsed && parsed.tools && Array.isArray(parsed.tools))
            ? parsed.tools
            : (parsed && parsed.result && Array.isArray(parsed.result.tools))
                ? parsed.result.tools
                : null;

        if (!Array.isArray(tools)) {
            return { ok: false, toolCount: null, nodeCount: null, warning: null, error: 'no tools returned' };
        }

        const toolCount = tools.length;
        const nodeCount = countJsonNodes(parsed.tools ? parsed.tools : (parsed.result && parsed.result.tools ? parsed.result.tools : parsed));
        const counts = {};
        for (const t of tools) {
            const server = String(t.name || '').split('_1mcp_')[0] || 'unknown';
            counts[server] = (counts[server] || 0) + 1;
        }

        const parts = [];
        if (toolCount > SIZE_TOOL_LIMIT) {
            parts.push(`tool count (${toolCount}) exceeds safe limit (${SIZE_TOOL_LIMIT})`);
        }
        if (nodeCount > SIZE_NODE_LIMIT) {
            parts.push(`JSON AST nodes exceeds safe limit (${SIZE_NODE_LIMIT})`);
        }
        const warning = parts.length ? `${parts.join('; ')}; hint: ${SIZE_HINT}` : null;

        return { ok: true, toolCount, nodeCount, counts, tools, warning };
    } catch (e) {
        return { ok: false, toolCount: null, nodeCount: null, warning: null, error: sanitize(e.message || String(e)) };
    }
}

async function gatewayToolCounts(opts = {}) {
    const res = await gatewaySizeMetrics(opts);
    return res && res.ok ? res.counts : null;
}

// Servers a harness sees behind one preset: the resolved selection minus the names that preset's
// exclusion list bans (template presets, same format as the shipped mcp_config.json "presets" block).
function visibleServersFor(preset, presets, selection) {
    const all = Array.isArray(selection) && selection.length ? [...selection] : [...GATEWAY_SERVERS];
    const excluded = Array.isArray(presets && presets[preset]) ? presets[preset] : [];
    return all.filter((n) => !excluded.includes(n));
}

// One row per harness file pointing at the gateway: its preset, the visible servers, the live tool
// count (null when the gateway did not answer) and the estimated tokens (always marked by the caller).
function gatewayExposureRows({ files = [], toolCounts = {}, selection = [], presets = {} } = {}) {
    const rows = [];
    const parseFromUrl = (u) => { try { return new URL(String(u)).searchParams.get('preset'); } catch { return null; } };
    for (const { file, kind: hint } of files) {
        const kind = classify(file, hint);
        if (!SUPPORTED.has(kind)) continue;
        let preset;
        if (kind === 'codex') {
            let text;
            try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
            const m = /(?:^|\n)\s*\[mcp_servers\.aos\][\s\S]{0,400}?url\s*=\s*"([^"]*)"/.exec(text);
            if (!m || !tomlHasGateway(text)) continue;
            preset = parseFromUrl(m[1]);
        } else {
            let loaded;
            try { loaded = load(file); } catch { continue; }
            if (!loaded || loaded.bad) continue;
            const map = mapOf(loaded.data, kind);
            if (!map || !isAosShaped(map.aos)) continue;
            preset = parseFromUrl(map.aos.url || map.aos.serverUrl || '');
        }
        const visible = visibleServersFor(preset, presets, selection);
        const counted = visible.every((n) => toolCounts[n] !== undefined);
        const tools = counted ? visible.reduce((a, n) => a + Number(toolCounts[n]), 0) : null;
        rows.push({ file, kind, preset: preset || null, servers: visible, tools, estimatedTokens: counted ? tools * TOKENS_PER_TOOL : null });
    }
    return rows;
}

module.exports = { gatewayChecks, gatewayFiles, dupeLabel, directGatewayNames, gatewayToolCounts, gatewaySizeMetrics, countJsonNodes, visibleServersFor, gatewayExposureRows, TOKENS_PER_TOOL, SIZE_TOOL_LIMIT, SIZE_NODE_LIMIT, SIZE_HINT };
