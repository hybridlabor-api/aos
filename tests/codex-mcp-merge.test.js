const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { mergeCodexTomlMcpServers } = require('../installer.js');

describe('mergeCodexTomlMcpServers', () => {
    test('merges AOS servers into config.toml, skips user-owned tables, and is idempotent', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-codex-mcp-'));
        const file = path.join(tmp, 'config.toml');
        fs.writeFileSync(file, '[features]\nhooks = true\n\n[mcp_servers.openwiki]\ncommand = "openwiki"\n');

        const servers = {
            openwiki: { command: 'x' },
            memb_mcp: { command: '/py', args: ['/run.py'], env: { GEMINI_API_KEY: '' } },
        };

        const skipped = mergeCodexTomlMcpServers(file, servers);
        const afterFirst = fs.readFileSync(file, 'utf8');

        assert.deepEqual(skipped, ['openwiki']);
        assert.equal(
            afterFirst.split('\n').filter((l) => l === '[mcp_servers.openwiki]').length,
            1,
            'user-owned openwiki table must not be duplicated'
        );
        assert.ok(afterFirst.includes('[mcp_servers.memb_mcp]'));
        assert.ok(afterFirst.includes('# AOS:MCP:START'));
        assert.ok(afterFirst.includes('# AOS:MCP:END'));
        assert.ok(afterFirst.includes('env = { GEMINI_API_KEY = "" }'));

        mergeCodexTomlMcpServers(file, servers);
        const afterSecond = fs.readFileSync(file, 'utf8');

        assert.equal(afterSecond, afterFirst, 're-run must not change the file');
        assert.equal(
            afterSecond.split('# AOS:MCP:START').length - 1,
            1,
            'exactly one AOS:MCP block after re-run'
        );

        fs.rmSync(tmp, { recursive: true, force: true });
    });
});
