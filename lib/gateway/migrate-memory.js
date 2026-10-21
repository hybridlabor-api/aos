'use strict';
// Migration on update: ensures memory (memb_mcp, deja) stays DIRECT per session in every harness.
// Removes memb_mcp and deja from the gateway's mcp.json (with backup) and adds them directly
// to harness configurations (Claude ~/.claude.json, Codex config.toml, OpenCode opencode.json,
// and Antigravity mcp_config.json) with backups, respecting unified memory opt-outs.

const fs = require('fs');
const path = require('path');
const { gatewayDir, defaultMcpsDir } = require('./config');
const { harnessMcpFiles, safeBackup, parseCodexTables } = require('../mcp-secrets');
const { writeAtomic, load, readMigration, writeMigration } = require('./harness');
const profile = require('../v5/profile');

const memDirectBackupName = (file, now) => `${file}.aos-memdirect-bak-${now}`;

function migrateMemoryDirect({ home, aosRoot, now = Date.now(), log = () => {}, dryRun = false, harnesses = true } = {}) {
    const say = typeof log === 'function' ? log : (m) => (log && log.info ? log.info(m) : null);
    const report = { gatewayCleaned: false, harnesses: [], recordsCleaned: 0 };

    // 1. Gateway mcp.json: remove memb_mcp and deja if present
    const gDir = gatewayDir(home);
    const mcpFile = path.join(gDir, 'mcp.json');
    if (fs.existsSync(mcpFile)) {
        try {
            const raw = fs.readFileSync(mcpFile, 'utf8');
            const data = JSON.parse(raw);
            if (data && data.mcpServers && (data.mcpServers.memb_mcp || data.mcpServers.deja)) {
                if (!dryRun) {
                    safeBackup(mcpFile, memDirectBackupName(mcpFile, now));
                    delete data.mcpServers.memb_mcp;
                    delete data.mcpServers.deja;
                    const tmp = `${mcpFile}.${process.pid}.tmp`;
                    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
                    fs.renameSync(tmp, mcpFile);
                }
                report.gatewayCleaned = true;
                say('gateway mcp.json: removed memb_mcp and deja (memory stays direct)');
            }
        } catch (e) {
            say(`could not migrate gateway mcp.json: ${e.message}`);
        }
    }

    // Clean stored gateway.servers in v5-settings.json if present
    try {
        const st = profile.readSettings(home, () => {});
        if (st && st.gateway && Array.isArray(st.gateway.servers) && (st.gateway.servers.includes('memb_mcp') || st.gateway.servers.includes('deja'))) {
            if (!dryRun) {
                const nextServers = st.gateway.servers.filter((n) => n !== 'memb_mcp' && n !== 'deja');
                profile.writeSettings(home, { ...st, gateway: { ...st.gateway, servers: nextServers } });
            }
        }
    } catch {}

    // 2. Clean migration.json records if memb_mcp or deja were recorded as removed by gateway
    try {
        const records = readMigration(home);
        const kept = records.filter((r) => r.key !== 'memb_mcp' && r.key !== 'deja');
        if (kept.length !== records.length) {
            report.recordsCleaned = records.length - kept.length;
            if (!dryRun) writeMigration(home, kept);
        }
    } catch {}

    // 3. Respect opt-outs: unified memory off, minimal profile, or --no-memory
    const st = profile.readSettings(home, () => {});
    const isMemoryExcluded = profile.excludedIds(st).has('memb');
    if (isMemoryExcluded) {
        say('unified memory is excluded/disabled; skipping direct harness registration');
        return report;
    }

    // 4. Build direct server definitions for memb_mcp and deja
    const mcpsDir = defaultMcpsDir(home);
    const launcher = path.join(aosRoot || path.join(home, '.agents'), 'bin', 'aos-mcp-env.mjs');
    const pyBin = (process.platform === 'win32'
        ? path.join(mcpsDir, 'memb-mcp', '.venv', 'Scripts', 'python.exe')
        : path.join(mcpsDir, 'memb-mcp', '.venv', 'bin', 'python')).split('\\').join('/');
    const runPy = path.join(mcpsDir, 'memb-mcp', 'run.py').split('\\').join('/');

    const membDirect = {
        command: 'node',
        args: [launcher, '--vars', 'GEMINI_API_KEY', '--memb-llm', '--', pyBin, runPy],
    };
    const dejaDirect = process.platform === 'win32'
        ? { command: 'cmd', args: ['/c', 'deja', 'mcp'] }
        : { command: 'deja', args: ['mcp'] };

    // 5. Check each harness config and add direct entries if missing
    if (!harnesses) return report;
    const files = harnessMcpFiles(home);
    for (const { file, kind } of files) {
        if (!fs.existsSync(file)) continue;
        try {
            if (kind === 'codex' || file.toLowerCase().endsWith('.toml')) {
                const text = fs.readFileSync(file, 'utf8');
                const tables = parseCodexTables(text);
                const missingMemb = !tables.memb_mcp;
                const missingDeja = !tables.deja;
                if (missingMemb || missingDeja) {
                    if (!dryRun) {
                        const bak = safeBackup(file, memDirectBackupName(file, now));
                        let append = '';
                        if (missingMemb) {
                            append += `[mcp_servers.memb_mcp]\ncommand = "node"\nargs = [${membDirect.args.map((a) => JSON.stringify(a)).join(', ')}]\n\n`;
                        }
                        if (missingDeja) {
                            append += `[mcp_servers.deja]\ncommand = ${JSON.stringify(dejaDirect.command)}\nargs = [${dejaDirect.args.map((a) => JSON.stringify(a)).join(', ')}]\n\n`;
                        }
                        const blockMatch = /(# AOS:MCP:START[\s\S]*?)(# AOS:MCP:END)/;
                        let nextText;
                        if (blockMatch.test(text)) {
                            nextText = text.replace(blockMatch, (m, p1, p2) => `${p1}${append}${p2}`);
                        } else {
                            nextText = text.trimEnd() + '\n\n' + append;
                        }
                        const tmp = `${file}.${process.pid}.tmp`;
                        fs.writeFileSync(tmp, nextText, 'utf8');
                        fs.renameSync(tmp, file);
                        report.harnesses.push({ file, kind: 'codex', backup: bak, added: [missingMemb && 'memb_mcp', missingDeja && 'deja'].filter(Boolean) });
                    } else {
                        report.harnesses.push({ file, kind: 'codex', added: [missingMemb && 'memb_mcp', missingDeja && 'deja'].filter(Boolean) });
                    }
                }
            } else if (kind === 'opencode' || /^opencode\./i.test(path.basename(file))) {
                const raw = fs.readFileSync(file, 'utf8');
                const loaded = load(file);
                if (!loaded || loaded.bad) continue;
                const data = loaded.data || {};
                data.mcp = data.mcp || {};
                const missingMemb = !data.mcp.memb_mcp;
                const missingDeja = !data.mcp.deja;
                if (missingMemb || missingDeja) {
                    if (!dryRun) {
                        const bak = safeBackup(file, memDirectBackupName(file, now));
                        if (missingMemb) data.mcp.memb_mcp = { type: 'local', command: [membDirect.command, ...membDirect.args], enabled: true };
                        if (missingDeja) data.mcp.deja = { type: 'local', command: [dejaDirect.command, ...dejaDirect.args], enabled: true };
                        writeAtomic(file, data, raw);
                        report.harnesses.push({ file, kind: 'opencode', backup: bak, added: [missingMemb && 'memb_mcp', missingDeja && 'deja'].filter(Boolean) });
                    } else {
                        report.harnesses.push({ file, kind: 'opencode', added: [missingMemb && 'memb_mcp', missingDeja && 'deja'].filter(Boolean) });
                    }
                }
            } else {
                // Claude, Antigravity, Cursor, etc.
                const raw = fs.readFileSync(file, 'utf8');
                const loaded = load(file);
                if (!loaded || loaded.bad) continue;
                const data = loaded.data || {};
                data.mcpServers = data.mcpServers || {};
                const missingMemb = !data.mcpServers.memb_mcp;
                const missingDeja = !data.mcpServers.deja;
                if (missingMemb || missingDeja) {
                    if (!dryRun) {
                        const bak = safeBackup(file, memDirectBackupName(file, now));
                        if (missingMemb) data.mcpServers.memb_mcp = membDirect;
                        if (missingDeja) data.mcpServers.deja = dejaDirect;
                        writeAtomic(file, data, raw);
                        report.harnesses.push({ file, kind: 'json', backup: bak, added: [missingMemb && 'memb_mcp', missingDeja && 'deja'].filter(Boolean) });
                    } else {
                        report.harnesses.push({ file, kind: 'json', added: [missingMemb && 'memb_mcp', missingDeja && 'deja'].filter(Boolean) });
                    }
                }
            }
        } catch (e) {
            say(`could not migrate harness ${file}: ${e.message}`);
        }
    }

    return report;
}

module.exports = { migrateMemoryDirect };
