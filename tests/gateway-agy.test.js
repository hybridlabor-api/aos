const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const harness = require('../lib/gateway/harness.js');
const sec = require('../lib/mcp-secrets.js');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = 'e'.repeat(64);
const shipped = sec.shippedServers(ROOT);

function fixture() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-agy-'));
    const g = path.join(home, '.gemini', 'config', 'mcp_config.json');
    const p = path.join(home, 'proj', '.agents', 'mcp_config.json');
    for (const f of [g, p]) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify({ mcpServers: { mine: { command: 'node', args: ['m.js'] }, github: sec.wrapServer('github', shipped.github, sec.launcherPath(home)) }, other: 1 }, null, 2));
    }
    return { home, g, p, files: [{ file: g, kind: 'json' }, { file: p, kind: 'json' }] };
}

test('classify recognises Antigravity global and workspace files only', () => {
    const fx = fixture();
    assert.equal(harness.classify(fx.g, 'json'), 'agy');
    assert.equal(harness.classify(fx.p, 'json'), 'agy');
    assert.equal(harness.classify(path.join(fx.home, '.gemini', 'antigravity-cli', 'mcp_config.json'), 'json'), 'agy-cli');
});

test('agy-cli uses the Antigravity {serverUrl, headers} entry shape, not the Claude fallback', () => {
    const entry = harness.entryFor('agy-cli', TOKEN);
    assert.deepEqual(entry, {
        serverUrl: harness.GATEWAY_URL,
        headers: { 'x-aos-token': TOKEN },
    });
    assert.strictEqual(entry.url, undefined, 'must not fall back to Claude url shape');
});

test('enable adds serverUrl aos, keeps unrelated content, backs up, is idempotent; disable restores', () => {
    const fx = fixture();
    const before = fs.readFileSync(fx.g, 'utf8');
    const rep = harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 1000 });
    assert.ok(rep.every((r) => r.kind === 'agy' && r.changed && !r.skipped && !r.error));
    const j = JSON.parse(fs.readFileSync(fx.g, 'utf8'));
    assert.deepEqual(j.mcpServers.aos, { serverUrl: harness.GATEWAY_URL, headers: { 'x-aos-token': TOKEN } });
    assert.equal(j.other, 1);
    assert.deepEqual(j.mcpServers.mine.args, ['m.js']);
    assert.equal(j.mcpServers.github, undefined);
    assert.equal(fs.readFileSync(rep[0].backup, 'utf8'), before);
    const again = harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 2000 });
    assert.ok(again.every((r) => !r.changed));
    const dis = harness.disable({ home: fx.home, files: fx.files, now: 3000 });
    assert.ok(dis.some((r) => r.removedAos));
    const back = JSON.parse(fs.readFileSync(fx.g, 'utf8'));
    assert.equal(back.mcpServers.aos, undefined);
    assert.ok(back.mcpServers.github);
});

test('AOS-shaped match is a prefix on the gateway URL, for url and serverUrl', () => {
    assert.ok(harness.isAosShaped({ url: `${harness.GATEWAY_URL}?preset=x` }));
    assert.ok(harness.isAosShaped({ serverUrl: harness.GATEWAY_URL }));
    assert.ok(!harness.isAosShaped({ serverUrl: 'http://example.com/mcp' }));
});

test('template presets: exclusions become an AND NOT chain, "all" gets no preset, enable writes ?preset=<kind> only for exclusions', () => {
    const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'mcp_config.json'), 'utf8')).presets;
    const { presetFor } = require('../lib/gateway/config.js');
    assert.equal(presetFor('agy', presets), 'aos AND NOT bdb_davinci_mcp');
    assert.equal(presetFor('claude', presets), null);
    assert.equal(presetFor('unknown', presets), null);
    assert.equal(presetFor('x', { x: ['a', 'b'] }), 'aos AND NOT a AND NOT b');

    const fx = fixture();
    harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, presets, now: 1000 });
    assert.equal(JSON.parse(fs.readFileSync(fx.g, 'utf8')).mcpServers.aos.serverUrl, `${harness.GATEWAY_URL}?preset=agy`);
    assert.ok(harness.isAosShaped({ serverUrl: `${harness.GATEWAY_URL}?preset=agy` }));

    const claude = path.join(fx.home, '.claude.json');
    fs.writeFileSync(claude, JSON.stringify({ mcpServers: {} }));
    harness.enable({ home: fx.home, token: TOKEN, shipped, files: [{ file: claude, kind: 'json' }], presets, now: 2000 });
    assert.equal(JSON.parse(fs.readFileSync(claude, 'utf8')).mcpServers.aos.url, harness.GATEWAY_URL);
});

test('shippedMcpTemplatePath returns gateway/upstream_template.json if present, else mcp_config.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-tmpl-'));
    // initially neither exists -> fallback to mcp_config.json
    assert.equal(sec.shippedMcpTemplatePath(dir), path.join(dir, 'mcp_config.json'));
    // with mcp_config.json present -> mcp_config.json
    fs.writeFileSync(path.join(dir, 'mcp_config.json'), '{}');
    assert.equal(sec.shippedMcpTemplatePath(dir), path.join(dir, 'mcp_config.json'));
    // with gateway/upstream_template.json present -> prefers upstream_template.json
    const gw = path.join(dir, 'gateway');
    fs.mkdirSync(gw, { recursive: true });
    fs.writeFileSync(path.join(gw, 'upstream_template.json'), '{}');
    assert.equal(sec.shippedMcpTemplatePath(dir), path.join(gw, 'upstream_template.json'));
});

test('gateway builds upstreams from new template location and fallback old location', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-up-'));
    const gw = path.join(dir, 'gateway');
    fs.mkdirSync(gw, { recursive: true });
    const templateContent = JSON.stringify({
        presets: { agy: 'all' },
        mcpServers: { github: { command: 'node', args: ['gh.js'] } }
    });
    fs.writeFileSync(path.join(gw, 'upstream_template.json'), templateContent);
    const serversNew = sec.shippedServers(dir);
    assert.ok(serversNew.github, 'reads from gateway/upstream_template.json');

    const dirOld = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-up-old-'));
    fs.writeFileSync(path.join(dirOld, 'mcp_config.json'), templateContent);
    const serversOld = sec.shippedServers(dirOld);
    assert.ok(serversOld.github, 'reads from fallback mcp_config.json');
});

test('migrateLegacyAgyWorkspaceMcp moves template copies and leaves user files untouched', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-mig-'));
    const agentsDir = path.join(home, '.agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    const target = path.join(agentsDir, 'mcp_config.json');
    const bak = path.join(agentsDir, 'mcp_config.json.aos-legacy.bak');

    // 1. Absent: nothing to do
    const resAbsent = sec.migrateLegacyAgyWorkspaceMcp(home, ROOT);
    assert.equal(resAbsent.migrated, false);
    assert.equal(resAbsent.reason, 'absent');

    // 2. User-owned config with custom server: untouched
    fs.writeFileSync(target, JSON.stringify({ mcpServers: { 'my-custom-tool': { command: 'node' } } }));
    const resUser = sec.migrateLegacyAgyWorkspaceMcp(home, ROOT);
    assert.equal(resUser.migrated, false);
    assert.equal(resUser.reason, 'user_owned');
    assert.ok(fs.existsSync(target), 'user-owned file must remain untouched');

    // 3. User-owned config with only 'aos': untouched
    fs.writeFileSync(target, JSON.stringify({ mcpServers: { aos: { serverUrl: 'http://127.0.0.1:7790' } } }));
    const resAos = sec.migrateLegacyAgyWorkspaceMcp(home, ROOT);
    assert.equal(resAos.migrated, false);
    assert.ok(fs.existsSync(target), 'file with only aos must remain untouched');

    // 4. Byte-identical copy of shipped template: moved to .bak
    const templatePath = sec.shippedMcpTemplatePath(ROOT);
    fs.copyFileSync(templatePath, target);
    const resByte = sec.migrateLegacyAgyWorkspaceMcp(home, ROOT);
    assert.equal(resByte.migrated, true);
    assert.ok(!fs.existsSync(target), 'target must be removed');
    assert.ok(fs.existsSync(bak), 'backup file must exist');

    // 5. Idempotent: second run does nothing
    const resIdemp = sec.migrateLegacyAgyWorkspaceMcp(home, ROOT);
    assert.equal(resIdemp.migrated, false);
    assert.equal(resIdemp.reason, 'absent');

    // 6. JSON copy containing shipped server keys (>1): moved to .bak
    fs.unlinkSync(bak);
    fs.writeFileSync(target, JSON.stringify({
        presets: {},
        mcpServers: {
            github: { command: 'node' },
            'chrome-devtools': { command: 'node' }
        }
    }));
    const resJson = sec.migrateLegacyAgyWorkspaceMcp(home, ROOT);
    assert.equal(resJson.migrated, true);
    assert.ok(!fs.existsSync(target));
    assert.ok(fs.existsSync(bak));
});

test('installGlobalBinaries writes gateway/upstream_template.json and does not write ~/.agents/mcp_config.json', () => {
    const installer = require('../installer.js');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-inst-'));
    const oldHome = process.env.HOME;
    const oldUserprofile = process.env.USERPROFILE;
    try {
        process.env.HOME = home;
        process.env.USERPROFILE = home;
        installer.installGlobalBinaries(home);
        assert.ok(fs.existsSync(path.join(home, '.agents', 'gateway', 'upstream_template.json')), 'upstream_template.json exists');
        assert.ok(!fs.existsSync(path.join(home, '.agents', 'mcp_config.json')), 'mcp_config.json must not exist in ~/.agents');
    } finally {
        process.env.HOME = oldHome;
        process.env.USERPROFILE = oldUserprofile;
    }
});

test('doctor check agy workspace MCP reports warning on legacy servers and ok when clean', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-doc-'));
    const agentsDir = path.join(home, '.agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    const target = path.join(agentsDir, 'mcp_config.json');

    function evalDoctorCheck(fPath) {
        if (!fs.existsSync(fPath)) return { ok: true, name: 'agy workspace MCP', fix: '' };
        let data = null;
        try { data = JSON.parse(fs.readFileSync(fPath, 'utf8')); } catch {}
        const servers = Object.keys(data?.mcpServers || {});
        const foreign = servers.filter((s) => s !== 'aos' && s !== 'mcsc');
        if (!foreign.length) return { ok: true, name: 'agy workspace MCP', fix: '' };
        return { ok: false, name: 'agy workspace MCP', fix: 'aos repair', warningOnly: true };
    }

    assert.strictEqual(evalDoctorCheck(target).ok, true);
    fs.writeFileSync(target, JSON.stringify({ mcpServers: { aos: {}, mcsc: {} } }));
    assert.strictEqual(evalDoctorCheck(target).ok, true);
    fs.writeFileSync(target, JSON.stringify({ mcpServers: { github: {}, 'chrome-devtools': {} } }));
    const docRes = evalDoctorCheck(target);
    assert.strictEqual(docRes.ok, false);
    assert.strictEqual(docRes.fix, 'aos repair');
    assert.strictEqual(docRes.warningOnly, true);
});

test('migrateLegacyAgyWorkspaceMcp keeps the only template copy until gateway/upstream_template.json exists', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-agy-only-'));
    const agents = path.join(home, '.agents');
    fs.mkdirSync(agents, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'mcp_config.json'), path.join(agents, 'mcp_config.json'));
    const res = sec.migrateLegacyAgyWorkspaceMcp(home, agents);
    assert.strictEqual(res.migrated, false);
    assert.strictEqual(res.reason, 'template_not_relocated');
    assert.ok(fs.existsSync(path.join(agents, 'mcp_config.json')), 'the only template copy must stay');
    fs.mkdirSync(path.join(agents, 'gateway'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'mcp_config.json'), path.join(agents, 'gateway', 'upstream_template.json'));
    const res2 = sec.migrateLegacyAgyWorkspaceMcp(home, agents);
    assert.strictEqual(res2.migrated, true);
    assert.ok(!fs.existsSync(path.join(agents, 'mcp_config.json')));
    assert.ok(fs.existsSync(path.join(agents, 'mcp_config.json.aos-legacy.bak')));
});
