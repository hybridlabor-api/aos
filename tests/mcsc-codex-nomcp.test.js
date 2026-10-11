const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const load = (rel) => import(pathToFileURL(path.join(root, 'mcps', 'mcsc', 'packages', 'core', 'src', rel)).href);

test('codexServerNames prefers the codex mcp list runner and falls back to config.toml on failure', async () => {
    const { codexServerNames } = await load('no-mcp.js');
    assert.deepEqual(codexServerNames({ list: () => ['aos', 'mcsc'], readToml: () => ['ignored'] }), ['aos', 'mcsc']);
    assert.deepEqual(codexServerNames({ list: () => [], readToml: () => ['ignored'] }), []);
    assert.deepEqual(codexServerNames({ list: () => null, readToml: () => ['openwiki'] }), ['openwiki']);
});

test('readToml fallback reads [mcp_servers.<name>] headers only, not sub-tables', async () => {
    const { codexServerNames } = await load('no-mcp.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-toml-'));
    try {
        fs.writeFileSync(path.join(dir, 'config.toml'), '[mcp_servers.aos]\nurl = "x"\n[mcp_servers.aos.env]\nK = "v"\n[mcp_servers."a.b"]\n');
        const prev = process.env.CODEX_HOME;
        process.env.CODEX_HOME = dir;
        try {
            assert.deepEqual(codexServerNames({ list: () => null }), ['aos', 'a.b']);
        } finally {
            if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev;
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('codexNoMcpArgs disables each server with a -c override and skips names it cannot address', async () => {
    const { codexNoMcpArgs } = await load('no-mcp.js');
    assert.deepEqual(codexNoMcpArgs(['aos', 'codebase_memory_mcp']), [
        '-c', 'mcp_servers.aos.enabled=false',
        '-c', 'mcp_servers.codebase_memory_mcp.enabled=false',
    ]);
    assert.deepEqual(codexNoMcpArgs(['a.b']), []);
    assert.deepEqual(codexNoMcpArgs([]), []);
});

test('codexNoMcpEnv merges into an existing CODEX_CONFIG and leaves unparsable input alone', async () => {
    const { codexNoMcpEnv } = await load('no-mcp.js');
    assert.deepEqual(JSON.parse(codexNoMcpEnv({}, ['aos']).CODEX_CONFIG), { mcp_servers: { aos: { enabled: false } } });
    const merged = JSON.parse(codexNoMcpEnv({ CODEX_CONFIG: '{"model":"m","mcp_servers":{"aos":{"command":"x"}}}' }, ['aos', 'mcsc']).CODEX_CONFIG);
    assert.deepEqual(merged, { model: 'm', mcp_servers: { aos: { command: 'x', enabled: false }, mcsc: { enabled: false } } });
    assert.deepEqual(codexNoMcpEnv({ CODEX_CONFIG: 'not json' }, ['aos']), { CODEX_CONFIG: 'not json' });
    assert.deepEqual(codexNoMcpEnv({ A: '1' }, []), { A: '1' });
});
