'use strict';
// Doctor checks for the gateway, in aos-doctor's add() shape. Wired in by the aos orchestrator, not here.
const fs = require('fs');
const path = require('path');
const { gatewayDir, GATEWAY_PORT, GATEWAY_SERVERS } = require('./config');
const { isAosOwned } = require('../mcp-secrets');
const { SUPPORTED, classify, mapOf, load, isAosShaped, migrationPath } = require('./harness');

const LABEL = 'com.bdb.aos.gateway';

// status = result of gatewayStatus() when the caller has it; shipped enables the "still direct" ownership test.
function gatewayChecks({ home, files = [], status, shipped, platform = process.platform }) {
    const dir = gatewayDir(home);
    const tokenFile = path.join(dir, 'token');
    const plist = path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
    const installed = fs.existsSync(tokenFile) || fs.existsSync(plist) || fs.existsSync(path.join(dir, 'mcp.json'));
    const out = [];
    const add = (name, ok, detail, fix, warningOnly = false) => out.push({ area: 'gateway', name, ok, detail, fix: ok ? '' : fix, warningOnly: warningOnly || !installed });

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

    let anyAos = false;
    for (const { file, kind: hint } of files) {
        const kind = classify(file, hint);
        if (!SUPPORTED.has(kind)) continue;
        let loaded;
        try { loaded = load(file); } catch { continue; }
        if (!loaded || loaded.bad) continue;
        const map = mapOf(loaded.data, kind);
        if (!map) continue;
        const has = isAosShaped(map.aos);
        anyAos = anyAos || has;
        add(`gateway entry in ${file}`, has, has ? 'aos entry present' : 'no AOS-shaped "aos" entry', 'aos-gateway enable');
        if (has) {
            const dup = GATEWAY_SERVERS.filter((n) => map[n] !== undefined && (!shipped || isAosOwned(n, kind === 'opencode' ? { command: (map[n].command || [])[0], args: (map[n].command || []).slice(1) } : map[n], shipped[n], shipped)));
            add(`gateway duplicates in ${file}`, dup.length === 0, dup.length ? `also direct: ${dup.join(', ')}` : 'none', 'aos-gateway enable (removes the AOS-owned direct entries)');
        }
    }
    if (anyAos) add('gateway migration record', fs.existsSync(migrationPath(home)), migrationPath(home), 'without it "aos-gateway direct" cannot restore the original entries; restore from the *.aos-gateway-bak-* backups');

    let leftovers = [];
    try { leftovers = fs.readdirSync(dir).filter((n) => /^node_modules\.removed-/.test(n)); } catch { /* no dir */ }
    for (const n of leftovers) {
        const p = path.join(dir, n);
        add(`leftover ${n}`, false, p, `delete manually once nothing needs it: rm -r ${p}`, true);
    }
    return out;
}

module.exports = { gatewayChecks };
