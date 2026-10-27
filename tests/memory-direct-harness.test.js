const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrateMemoryDirect } = require('../lib/gateway/migrate-memory.js');
const { parseCodexTables } = require('../lib/mcp-secrets.js');
const profile = require('../lib/v5/profile.js');
const { fakeComponents } = require('./helpers/memdirect-env.js');

const ROOT = path.resolve(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-memdirect-harness-'));

test('migrateMemoryDirect adds direct memb_mcp and deja entries to Claude, Codex, OpenCode, and Antigravity', () => {
    const home = tmp();
    const claudeJson = path.join(home, '.claude.json');
    const codexToml = path.join(home, '.codex', 'config.toml');
    const opencodeJson = path.join(home, '.config', 'opencode', 'opencode.json');
    const agyJson = path.join(home, '.gemini', 'config', 'mcp_config.json');

    fs.mkdirSync(path.dirname(codexToml), { recursive: true });
    fs.mkdirSync(path.dirname(opencodeJson), { recursive: true });
    fs.mkdirSync(path.dirname(agyJson), { recursive: true });

    fs.writeFileSync(claudeJson, JSON.stringify({ mcpServers: { aos: { type: 'http', url: 'http://127.0.0.1:7790/mcp' } } }, null, 2));
    fs.writeFileSync(codexToml, '[model]\nname = "test"\n\n# AOS:MCP:START\n[mcp_servers.aos]\nurl = "http://127.0.0.1:7790/mcp"\n# AOS:MCP:END\n');
    fs.writeFileSync(opencodeJson, JSON.stringify({ mcp: { aos: { type: 'remote', url: 'http://127.0.0.1:7790/mcp' } } }, null, 2));
    fs.writeFileSync(agyJson, JSON.stringify({ mcpServers: { aos: { type: 'http', url: 'http://127.0.0.1:7790/mcp' } } }, null, 2));

    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 12345678, env: fakeComponents(home) });
    assert.equal(rep.harnesses.length, 4);

    // 1. Claude
    const cData = JSON.parse(fs.readFileSync(claudeJson, 'utf8'));
    assert.ok(cData.mcpServers.memb_mcp, 'Claude has memb_mcp');
    assert.ok(cData.mcpServers.deja, 'Claude has deja');
    assert.equal(cData.mcpServers.memb_mcp.command, process.execPath);
    assert.ok(cData.mcpServers.memb_mcp.args.some((a) => a.includes('aos-mcp-env.mjs')));
    assert.ok(cData.mcpServers.memb_mcp.args.includes('GEMINI_API_KEY'));

    // 2. Codex
    const codexText = fs.readFileSync(codexToml, 'utf8');
    const tables = parseCodexTables(codexText);
    assert.ok(tables.memb_mcp, 'Codex has memb_mcp table');
    assert.ok(tables.deja, 'Codex has deja table');
    assert.equal(tables.memb_mcp.fields.command, process.execPath);
    assert.ok(tables.memb_mcp.fields.args.some((a) => a.includes('aos-mcp-env.mjs')));

    // 3. OpenCode
    const ocData = JSON.parse(fs.readFileSync(opencodeJson, 'utf8'));
    assert.ok(ocData.mcp.memb_mcp, 'OpenCode has memb_mcp');
    assert.ok(ocData.mcp.deja, 'OpenCode has deja');
    assert.equal(ocData.mcp.memb_mcp.type, 'local');
    assert.equal(ocData.mcp.deja.type, 'local');

    // 4. Antigravity
    const agyData = JSON.parse(fs.readFileSync(agyJson, 'utf8'));
    assert.ok(agyData.mcpServers.memb_mcp, 'Antigravity has memb_mcp');
    assert.ok(agyData.mcpServers.deja, 'Antigravity has deja');

    // 5. Backups created
    assert.ok(fs.existsSync(`${claudeJson}.aos-memdirect-bak-12345678`));
    assert.ok(fs.existsSync(`${codexToml}.aos-memdirect-bak-12345678`));
    assert.ok(fs.existsSync(`${opencodeJson}.aos-memdirect-bak-12345678`));
    assert.ok(fs.existsSync(`${agyJson}.aos-memdirect-bak-12345678`));

    // 6. Idempotency: running again adds nothing
    const rep2 = migrateMemoryDirect({ home, aosRoot: ROOT, now: 12345679, env: fakeComponents(home) });
    assert.equal(rep2.harnesses.length, 0);
});

test('migrateMemoryDirect respects memory opt-outs (excluded memb, minimal profile)', () => {
    const home = tmp();
    const claudeJson = path.join(home, '.claude.json');
    fs.writeFileSync(claudeJson, JSON.stringify({ mcpServers: { aos: { type: 'http', url: 'http://127.0.0.1:7790/mcp' } } }, null, 2));

    // Opt-out via disabled array
    profile.writeSettings(home, { disabled: ['memb'] });
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 100 });
    assert.equal(rep.harnesses.length, 0);

    const cData = JSON.parse(fs.readFileSync(claudeJson, 'utf8'));
    assert.strictEqual(cData.mcpServers.memb_mcp, undefined);
    assert.strictEqual(cData.mcpServers.deja, undefined);
});
