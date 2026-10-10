const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const harness = require('../lib/gateway/harness.js');

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

test('a missing config.toml is left alone', () => {
    const fx = fixture();
    fs.rmSync(fx.file);
    assert.deepEqual(harness.enable({ home: fx.home, token: TOKEN, shipped: {}, files: fx.files, now: 1 }), []);
    assert.equal(fs.existsSync(fx.file), false);
});
