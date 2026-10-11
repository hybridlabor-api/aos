'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { resolveWsPort, DEFAULT_WS_PORT } = require(path.join(ROOT, 'mcps', 'adobe_uxp_mcp', 'port.js'));

const viaCb = (v) => new Promise((res) => resolveWsPort(v, res));

test('resolveWsPort: unset and invalid values fall back to 8080', async () => {
    assert.equal(DEFAULT_WS_PORT, 8080);
    assert.equal(await viaCb(undefined), 8080);
    assert.equal(await viaCb(''), 8080);
    assert.equal(await viaCb('abc'), 8080);
    assert.equal(await viaCb('8080.5'), 8080);
    assert.equal(await viaCb('1023'), 8080);   // below range
    assert.equal(await viaCb('65536'), 8080);  // above range
    assert.equal(await viaCb('-1'), 8080);
});

test('resolveWsPort: valid integer in 1024-65535 is used as-is', async () => {
    assert.equal(await viaCb('12345'), 12345);
    assert.equal(await viaCb('1024'), 1024);
    assert.equal(await viaCb('65535'), 65535);
    assert.equal(await viaCb('8081'), 8081);
});

test('resolveWsPort: "auto" picks a free port in range (listen(0) on 127.0.0.1)', async () => {
    const port = await viaCb('auto');
    assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, `free port in range: ${port}`);
});

test('grandma3 default is 8081 in the shipped template (no collision with adobe_uxp 8080)', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'mcp_config.json'), 'utf8'));
    const args = cfg.mcpServers.bdb_grandma3_mcp.args;
    assert.ok(args.includes('8081'), `grandma3 template pins 8081: ${JSON.stringify(args)}`);
    assert.ok(!args.includes('8080'), 'grandma3 template must not pin 8080 anymore');
    const py = fs.readFileSync(path.join(ROOT, 'mcps', 'grandma3_mcp.py'), 'utf8');
    assert.match(py, /--port["']?,? ?default="8081"/, 'grandma3_mcp.py --port default is 8081');
    // the legacy shape (older releases) stays on 8080 so old installs remain AOS-owned
    const secrets = fs.readFileSync(path.join(ROOT, 'lib', 'mcp-secrets.js'), 'utf8');
    assert.ok(secrets.includes("'--port', '8080', '--mode', 'webapi_only'"), 'LEGACY_SHAPES keep the old 8080 shape');
});

test('direct mode pins the fixed port 8080 at the installer write site (plugins hard-code ws://localhost:8080); entry resolves env AOS_UXP_PORT', () => {
    const installer = fs.readFileSync(path.join(ROOT, 'installer.js'), 'utf8');
    assert.ok(installer.includes("AOS_UXP_PORT: '8080'"), 'installer injects the FIXED AOS_UXP_PORT=8080 for adobe_uxp_mcp (direct mode)');
    assert.ok(!installer.includes('AOS_UXP_PORT: \'auto\''), 'direct-mode entries must not get auto (plugins hard-code 8080)');
    const entry = fs.readFileSync(path.join(ROOT, 'mcps', 'adobe_uxp_mcp', 'index.js'), 'utf8');
    assert.match(entry, /process\.env\.AOS_UXP_PORT/, 'entry reads AOS_UXP_PORT');
    assert.ok(!entry.match(/WebSocket\.Server\(\{ port: 8080 \}\)/), 'no fixed 8080 constructor anymore');
    // gateway mode stays on the template (no AOS_UXP_PORT there -> server default 8080)
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'mcp_config.json'), 'utf8'));
    const env = cfg.mcpServers.adobe_uxp_mcp && cfg.mcpServers.adobe_uxp_mcp.env;
    assert.ok(!env || !('AOS_UXP_PORT' in env), 'shipped template keeps default 8080');
});
