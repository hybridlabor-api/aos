const { test } = require('node:test');
const assert = require('node:assert');
const harness = require('../lib/gateway/harness.js');
const sec = require('../lib/mcp-secrets.js');
const rows = require('../lib/harnesses.json');

const TOKEN = 'a'.repeat(64);
const ctx = { home: '/h/home', env: { CLAUDE_CONFIG_DIR: '/c/cc', CODEX_HOME: '/c/codex' }, platform: 'darwin', cwd: '/w/proj' };
const resolved = (r) => [...r.mcp.global, ...r.mcp.workspace].map((p) => sec.resolveHarnessPath(p, ctx));

test('every row parses: unique id, known format, boolean verified, tokens resolve', () => {
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
    for (const r of rows) {
        assert.ok(['json', 'jsonc', 'toml'].includes(r.format), r.id);
        assert.equal(typeof r.verified, 'boolean', r.id);
        assert.ok(resolved(r).every(Boolean), `${r.id}: unresolved token`);
    }
});

test('classify maps every row path back to its row id', () => {
    for (const r of rows) for (const file of resolved(r)) assert.equal(harness.classify(file, r.hint), r.id, file);
});

test('SUPPORTED is exactly the verified rows; unverified rows are never written', () => {
    assert.deepEqual([...harness.SUPPORTED].sort(), ['agy', 'claude', 'cline', 'codex', 'cursor', 'opencode', 'roo', 'windsurf']);
    for (const r of rows.filter((x) => !x.verified)) assert.ok(!harness.SUPPORTED.has(r.id), r.id);
});

test('entryFor per verified row keeps the old shapes, and ?preset= is appended', () => {
    const url = harness.GATEWAY_URL;
    const h = { 'X-AOS-Token': TOKEN };
    assert.deepEqual(harness.entryFor('claude', TOKEN), { type: 'http', url, headers: h });
    assert.deepEqual(harness.entryFor('codex', TOKEN), { type: 'http', url, headers: h });
    assert.deepEqual(harness.entryFor('cursor', TOKEN), { url, headers: h });
    assert.deepEqual(harness.entryFor('roo', TOKEN), { type: 'streamable-http', url, headers: h });
    assert.deepEqual(harness.entryFor('agy', TOKEN), { serverUrl: url, headers: { 'x-aos-token': TOKEN } });
    assert.deepEqual(harness.entryFor('opencode', TOKEN), { type: 'remote', url, headers: h, enabled: true });
    assert.deepEqual(harness.entryFor('cursor-app', TOKEN), { url, headers: h });
    assert.deepEqual(harness.entryFor('agy-cli', TOKEN), { serverUrl: url, headers: { 'x-aos-token': TOKEN } });
    assert.deepEqual(harness.entryFor('windsurf', TOKEN), { serverUrl: url, headers: h });
    assert.deepEqual(harness.entryFor('cline', TOKEN), { type: 'streamableHttp', url, headers: h });
    assert.deepEqual(harness.entryFor('vscode', TOKEN), { type: 'http', url, headers: h });
    assert.deepEqual(harness.entryFor('roo', TOKEN, 'aos-core'), { type: 'streamable-http', url: `${url}?preset=aos-core`, headers: h });
});

test('mapKey reads the row root; unknown kinds keep mcpServers', () => {
    assert.equal(harness.mapKey('opencode'), 'mcp');
    assert.equal(harness.mapKey('roo'), 'mcpServers');
    assert.equal(harness.mapKey('vscode'), 'servers');
    assert.equal(harness.mapKey('nope'), 'mcpServers');
});

test('every row has valid skills_mode, skills_dir, rules_file, and plugin schema', () => {
    const validModes = new Set(['native', 'plugin', 'symlink', 'copy', 'none']);
    const validPlugins = new Set(['none', 'commands+agents', 'hooks', 'full']);
    for (const r of rows) {
        assert.ok(validModes.has(r.skills_mode), `${r.id}: invalid skills_mode ${r.skills_mode}`);
        assert.ok(r.skills_dir === null || typeof r.skills_dir === 'string', `${r.id}: skills_dir must be string or null`);
        assert.ok(r.rules_file === null || typeof r.rules_file === 'string', `${r.id}: rules_file must be string or null`);
        assert.ok(validPlugins.has(r.plugin), `${r.id}: invalid plugin ${r.plugin}`);
    }
    const cursor = rows.find((r) => r.id === 'cursor');
    assert.equal(cursor.skills_dir, '~/.cursor/skills');
    assert.equal(cursor.skills_mode, 'copy');
    const agy = rows.find((r) => r.id === 'agy');
    assert.equal(agy.skills_dir, '~/.gemini/config/plugins/bdb-aos/skills');
    assert.equal(agy.skills_mode, 'plugin');
    assert.equal(agy.plugin, 'full');
});

// Runtime-added row case skipped: lib/harnesses.json is loaded once and the loader has no override path.
