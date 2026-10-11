const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const harness = require('../lib/gateway/harness.js');
const sec = require('../lib/mcp-secrets.js');
const doctor = require('../lib/gateway/doctor.js');

const TOKEN = 'f'.repeat(64);
const ORIGINAL = '[model]\nname = "x"\n\n[mcp_servers.mine]\ncommand = "node"\nargs = ["m.js"]\n';

function fixture(text = ORIGINAL) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-codex-'));
    const file = path.join(home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return { home, file, files: [{ file, kind: 'toml' }] };
}

test('classify recognises config.toml as codex', () => {
    const fx = fixture();
    assert.equal(harness.classify(fx.file, 'toml'), 'codex');
});

test('enable appends [mcp_servers.aos], keeps the rest byte for byte, backs up, is idempotent; disable restores', () => {
    const fx = fixture();
    const rep = harness.enable({ home: fx.home, token: TOKEN, shipped: {}, files: fx.files, now: 1000 });
    assert.ok(rep[0].added && rep[0].changed && !rep[0].error);
    const text = fs.readFileSync(fx.file, 'utf8');
    assert.ok(text.startsWith(ORIGINAL));
    assert.ok(text.includes(`[mcp_servers.aos]\nurl = "${harness.GATEWAY_URL}"\nhttp_headers = { "x-aos-token" = "${TOKEN}" }\n`));
    assert.equal(fs.readFileSync(rep[0].backup, 'utf8'), ORIGINAL);
    const again = harness.enable({ home: fx.home, token: TOKEN, shipped: {}, files: fx.files, now: 2000 });
    assert.ok(!again[0].changed);
    assert.equal(fs.readFileSync(fx.file, 'utf8'), text);
    const dis = harness.disable({ home: fx.home, files: fx.files, now: 3000 });
    assert.ok(dis[0].removedAos);
    assert.equal(fs.readFileSync(fx.file, 'utf8'), ORIGINAL);
});

test('a user-owned [mcp_servers.aos] table is never overwritten', () => {
    const user = '[mcp_servers.aos]\ncommand = "mine"\n';
    const fx = fixture(user);
    const rep = harness.enable({ home: fx.home, token: TOKEN, shipped: {}, files: fx.files, now: 1 });
    assert.match(rep[0].conflict, /user-owned/);
    assert.equal(fs.readFileSync(fx.file, 'utf8'), user);
    assert.match(harness.disable({ home: fx.home, files: fx.files, now: 2 })[0].conflicts[0], /not AOS-shaped/);
    assert.equal(fs.readFileSync(fx.file, 'utf8'), user);
});

test('an [mcp_servers.aos] header with a trailing comment is the gateway table, never duplicated', () => {
    const text = `[mcp_servers.aos] # AOS:MCP\nurl = "${harness.GATEWAY_URL}"\nhttp_headers = { "x-aos-token" = "${TOKEN}" }\n`;
    const fx = fixture(text);
    const rep = harness.enable({ home: fx.home, token: TOKEN, shipped: {}, files: fx.files, now: 1 });
    assert.ok(!rep[0].error && !rep[0].conflict);
    assert.equal(fs.readFileSync(fx.file, 'utf8').match(/\[mcp_servers\.aos\]/g).length, 1);
});

test('trailing comments and multi-line arrays are read, not left unparsed', () => {
    const t = sec.parseCodexTables('[mcp_servers.mine]\ncommand = "node" # the server\nargs = [\n    "m.js", # entry\n    "--x"\n]\n').mine;
    assert.deepEqual(t.unparsed, []);
    assert.equal(t.fields.command, 'node');
    assert.deepEqual(t.fields.args, ['m.js', '--x']);
});

test('doctor reports a covered table aos-gateway cannot read instead of keeping it silently direct', () => {
    const fx = fixture();
    harness.enable({ home: fx.home, token: TOKEN, shipped: {}, files: fx.files, now: 1 });
    fs.appendFileSync(fx.file, '[mcp_servers.github]\ncommand = node_bin\n');
    const row = doctor.gatewayChecks({ home: fx.home, files: fx.files, shipped: {}, platform: 'linux', nodeMajor: 24 })
        .find((c) => c.name === `gateway tables not verified in ${fx.file}`);
    assert.equal(row.ok, false);
    assert.match(row.detail, /github/);
});

test('a missing config.toml is left alone', () => {
    const fx = fixture();
    fs.rmSync(fx.file);
    assert.deepEqual(harness.enable({ home: fx.home, token: TOKEN, shipped: {}, files: fx.files, now: 1 }), []);
    assert.equal(fs.existsSync(fx.file), false);
});
