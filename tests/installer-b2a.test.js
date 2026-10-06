// 4.18.2 installer bugs (aos-07 list, aos-16/17): OpenWiki env, Synapse message, -y modules, uv lookup,
// Codex user MCP tables, mcsc in agy configs. Sandbox HOME is set before installer.js is loaded.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-b2a-'));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
const inst = require('../installer.js');
const ROOT = path.resolve(__dirname, '..');
const sub = (name) => { const d = path.join(tmp, name + Math.random().toString(36).slice(2)); fs.mkdirSync(d, { recursive: true }); return d; };
const write = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };

test('openwiki: writes ~/.openwiki/.env with OPENWIKI_MODEL_ID, mode 600, no OPENWIKI_MODEL', () => {
    const f = path.join(sub('ow'), '.openwiki', '.env');
    const added = inst.writeOpenWikiEnv('sk-test', { provider: 'openai', model: 'gpt-5.5' }, f);
    const txt = fs.readFileSync(f, 'utf8');
    assert.deepStrictEqual(added, ['OPENWIKI_PROVIDER', 'OPENWIKI_MODEL_ID', 'OPENAI_API_KEY']);
    assert.match(txt, /^OPENWIKI_MODEL_ID=gpt-5\.5$/m);
    assert.match(txt, /^OPENWIKI_PROVIDER=openai$/m);
    assert.ok(!/^OPENWIKI_MODEL=/m.test(txt));
    assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
});

test('openwiki: existing user keys are never overwritten, secrets we do not have are never written', () => {
    const f = path.join(sub('ow'), '.env');
    write(f, 'OPENAI_API_KEY=user-key\nOPENWIKI_MODEL_ID=user-model\nOTHER=1');
    const added = inst.writeOpenWikiEnv('', { provider: 'openai', model: 'gpt-5.5' }, f);
    const txt = fs.readFileSync(f, 'utf8');
    assert.deepStrictEqual(added, ['OPENWIKI_PROVIDER']);
    assert.match(txt, /^OPENAI_API_KEY=user-key$/m);
    assert.match(txt, /^OPENWIKI_MODEL_ID=user-model$/m);
    assert.match(txt, /^OTHER=1$/m);
    assert.strictEqual((txt.match(/OPENAI_API_KEY/g) || []).length, 1);
    assert.deepStrictEqual(inst.writeOpenWikiEnv('sk-new', { provider: 'openai', model: 'gpt-5.5' }, f), []);
});

test('openwiki: google maps to the CLI provider gemini; groq goes through openai-compatible', () => {
    const f = path.join(sub('ow'), '.env');
    inst.writeOpenWikiEnv('g-key', { provider: 'google', model: 'gemini-3.5-flash' }, f);
    assert.match(fs.readFileSync(f, 'utf8'), /^OPENWIKI_PROVIDER=gemini$/m);
    assert.match(fs.readFileSync(f, 'utf8'), /^GEMINI_API_KEY=g-key$/m);
    const g = path.join(sub('ow'), '.env');
    inst.writeOpenWikiEnv('q', { provider: 'groq', model: 'llama-3.3-70b-versatile' }, g);
    const t = fs.readFileSync(g, 'utf8');
    assert.match(t, /^OPENWIKI_PROVIDER=openai-compatible$/m);
    assert.match(t, /^OPENAI_COMPATIBLE_BASE_URL=https:\/\/api\.groq\.com\/openai\/v1$/m);
    assert.match(t, /^OPENAI_COMPATIBLE_API_KEY=q$/m);
});

test('openwiki: an invalid model id is not written silently', () => {
    for (const bad of ['has space', 'https://x/y', 'a;rm -rf', 'x'.repeat(121)]) assert.ok(!inst.isValidOpenWikiModelId(bad), bad);
    for (const ok of ['gpt-5.5', 'meta/llama-3.3-70b-instruct', 'claude-sonnet-4-5@20250929', '@cf/meta/llama']) assert.ok(inst.isValidOpenWikiModelId(ok), ok);
    const f = path.join(sub('ow'), '.env');
    const added = inst.writeOpenWikiEnv('', { provider: 'openai', model: 'bad model!' }, f);
    assert.ok(!added.includes('OPENWIKI_MODEL_ID'));
    assert.ok(!/MODEL_ID/.test(fs.readFileSync(f, 'utf8')));
});

test('openwiki: no `openwiki auth <provider>` hint, no hard-coded Gemma 4 banner', () => {
    for (const rel of ['skills/global_config/aos-setup/scripts/aos-doctor.mjs', 'skills/global_config/aos-setup/SKILL.md',
        'skills/global_config/aos-project-init/SKILL.md', 'skills/global_config/aos-project-init/scripts/aos-project-doctor.mjs']) {
        assert.ok(!fs.readFileSync(path.join(ROOT, rel), 'utf8').includes('openwiki auth <provider>'), rel);
    }
    const py = fs.readFileSync(path.join(ROOT, 'skills/global_config/openwiki-skill/scripts/openwiki_daemon.py'), 'utf8');
    assert.ok(!py.includes('started (Gemma 4'));
    assert.match(py, /started \(direct API mode, provider=\{PROVIDER\}, model=\{MODEL_ID\}\)/);
    assert.match(py, /OPENWIKI_MODEL_ID/);
});

test('synapse: no binary for the platform gives an actionable message without undefined variables', () => {
    const dir = sub('syn');
    write(path.join(dir, 'bin', 'synapse-darwin-arm64'), 'x');
    assert.ok(inst.findSynapseBinary(dir, 'darwin', 'arm64').endsWith('synapse-darwin-arm64'));
    assert.strictEqual(inst.findSynapseBinary(dir, 'darwin', 'x64'), null);
    const noSrc = inst.describeMissingSynapseBinary(dir, 'darwin', 'x64');
    assert.match(noSrc, /darwin\/x64/);
    assert.ok(!/undefined/.test(noSrc));
    write(path.join(dir, 'cmd', 'synapse', 'main.go'), 'package main');
    assert.match(inst.describeMissingSynapseBinary(dir, 'darwin', 'x64'), /go build -o bin\/synapse \.\/cmd\/synapse\//);
    assert.ok(!/binaryName/.test(fs.readFileSync(path.join(ROOT, 'installer.js'), 'utf8')));
});

test('-y installs only the optional modules named by --modules / AOS_MODULES', async (t) => {
    if (!process.argv.includes('-y') && process.stdout.isTTY) return t.skip('needs the non-interactive path');
    const ran = [];
    const mods = ['synapse', 'memb', 'remote'].map((id) => ({ id, name: id, fn: async () => { ran.push(id); } }));
    assert.deepStrictEqual(inst.parseModuleSelection(['--modules=Synapse, memb'], {}), ['synapse', 'memb']);
    assert.deepStrictEqual(inst.parseModuleSelection([], { AOS_MODULES: 'all' }), ['all']);
    assert.deepStrictEqual(inst.parseModuleSelection(['-y'], {}), []);
    assert.deepStrictEqual(await inst.promptOptionalModules([], [], mods), []);
    assert.deepStrictEqual(ran, []);
    const done = await inst.promptOptionalModules(['memb'], ['synapse', 'memb', 'nope'], mods);
    assert.deepStrictEqual(done, ['synapse']);
    assert.deepStrictEqual(ran, ['synapse']);
    assert.deepStrictEqual(await inst.promptOptionalModules([], ['all'], mods), ['synapse', 'memb', 'remote']);
});

test('uv in ~/.local/bin is found when PATH has no uv', () => {
    const home = sub('uvh');
    const bin = path.join(home, '.local', 'bin', 'uv');
    write(bin, '#!/bin/sh\n');
    fs.chmodSync(bin, 0o755);
    const oldPath = process.env.PATH;
    process.env.PATH = '/usr/bin:/bin';
    try {
        assert.strictEqual(inst.findUv(home, 'linux'), bin);
    } finally { process.env.PATH = oldPath; }
});

test('codex: a user MCP table inside the AOS block (comfyui-mcp) survives the merge', () => {
    const f = path.join(sub('cx'), 'config.toml');
    write(f, [
        '# AOS:MCP:START',
        '[mcp_servers.memb_mcp]', 'command = "old"', '',
        '[mcp_servers.comfyui-mcp]', 'command = "uvx"', 'args = ["comfyui-mcp"]', '',
        '[mcp_servers.comfyui-mcp.env]', 'COMFY = "1"',
        '# AOS:MCP:END', ''].join('\n'));
    inst.mergeCodexTomlMcpServers(f, { memb_mcp: { command: 'node', args: ['m.js'] } });
    const run = () => fs.readFileSync(f, 'utf8');
    const once = run();
    assert.strictEqual((once.match(/^\[mcp_servers\.comfyui-mcp\]$/gm) || []).length, 1);
    assert.match(once, /^COMFY = "1"$/m);
    assert.match(once, /^command = "node"$/m);
    assert.ok(!once.includes('command = "old"'));
    inst.mergeCodexTomlMcpServers(f, { memb_mcp: { command: 'node', args: ['m.js'] } });
    assert.strictEqual(run(), once);
});

test('mcsc: the AOS entry is removed from agy configs, a user-owned mcsc and other servers stay', () => {
    const home = sub('agy');
    const cfg = path.join(home, '.gemini', 'config', 'mcp_config.json');
    write(cfg, JSON.stringify({ mcpServers: {
        mcsc: { command: 'node', args: [path.join(home, '.gemini', 'config', 'mcps', 'mcsc', 'server.js')] },
        mine: { command: 'foo' } } }));
    assert.ok(inst.isAgyMcpConfig(cfg, home));
    assert.strictEqual(inst.removeAosMcscFromAgyConfigs(home).length, 1);
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(cfg, 'utf8')).mcpServers), ['mine']);

    const home2 = sub('agy');
    const cfg2 = path.join(home2, '.gemini', 'config', 'mcp_config.json');
    const own = { mcpServers: { mcsc: { command: 'python3', args: ['/my/own/mcsc.py'] } } };
    write(cfg2, JSON.stringify(own));
    assert.deepStrictEqual(inst.removeAosMcscFromAgyConfigs(home2), []);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(cfg2, 'utf8')), own);
});

test('mcsc: the installer never writes mcsc into the agy primary config; doctor warns on it', () => {
    const src = fs.readFileSync(path.join(ROOT, 'installer.js'), 'utf8');
    assert.match(src, /if \(isAgyMcpConfig\(paths\.mcpConfigPath\)\)[\s\S]{0,300}delete parsed\.mcpServers\.mcsc/);
    const home = sub('doc');
    write(path.join(home, '.gemini', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { mcsc: { command: 'node', args: ['x/mcsc/server.js'] } } }));
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'aos-doctor.mjs'), '--json'],
        { cwd: home, env: { HOME: home, USERPROFILE: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    const hit = JSON.parse(r.stdout).results.find((x) => x.name === 'mcsc not in agy config');
    assert.ok(hit && !hit.ok && hit.warningOnly, r.stdout.slice(0, 300));
});
