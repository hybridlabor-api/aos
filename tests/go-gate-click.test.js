// WP-9: WebAuthn click receipts in the go-gate. A software ES256 authenticator signs the receipts; the gate must
// re-verify everything itself. Offline: temp HOME per test (left in place, nothing is deleted), real hook as child process.
// The gate only classifies the command strings below; nothing here executes them.
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const REPO = path.resolve(__dirname, '..');
const GATE = path.join(REPO, '.claude', 'hooks', 'go-gate.mjs');
const ORIGIN = 'http://localhost:5350';
const CMD = 'gh pr merge 5';
const MIN = 60 * 1000;

process.env.AOS_TEST_SANDBOX = '1';
process.env.GIT_CONFIG_NOSYSTEM = '1';
for (const k of Object.keys(process.env)) if (/^GIT_/.test(k) && k !== 'GIT_CONFIG_NOSYSTEM') delete process.env[k];

let g, SA, AT;
before(async () => {
    g = await import(pathToFileURL(GATE).href);
    SA = await import(pathToFileURL(path.join(__dirname, 'helpers', 'softauth.mjs')).href);
    AT = await import(pathToFileURL(path.join(__dirname, 'helpers', 'softauth-attest.mjs')).href);
});

let home, repo, t, auth, gdir, godir, seq = 0;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-click-'));
    process.env.HOME = home; // in-process calls of the gate module resolve ~/.aos from here
    gdir = path.join(home, '.aos', 'gate');
    godir = path.join(home, '.aos', 'go');
    fs.mkdirSync(gdir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(godir, { recursive: true, mode: 0o700 });
    repo = path.join(home, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/feat/work\n');
    fs.writeFileSync(path.join(repo, '.git', 'config'), '');
    t = path.join(home, 'session.jsonl');
    fs.writeFileSync(t, '');
    auth = SA.createSoftAuth({ origin: ORIGIN });
});

const env = () => ({ ...process.env, HOME: home, XDG_DATA_HOME: '', XDG_CONFIG_HOME: path.join(home, '.config'), AOS_SESSION_NAME: '', AOS_ACP_CLIENT: '', AOS_GATE_PROTECTED_BRANCHES: '' });
const runGate = (command, { session = 's1' } = {}) => spawnSync(process.execPath, [GATE], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path: t, session_id: session, cwd: repo }),
    env: env(), encoding: 'utf8', timeout: 20000,
});
const allowed = (cmd, opts) => { const r = runGate(cmd, opts); assert.equal(r.status, 0, `expected allowed: ${cmd} :: ${r.stderr}`); };
const denied = (cmd, opts) => { const r = runGate(cmd, opts); assert.equal(r.status, 2, `expected denied: ${cmd} (status ${r.status}, signal ${r.signal})`); };

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const challengeOf = (p) => crypto.createHash('sha256').update(JSON.stringify({
    v: 1, kind: p.kind, request_id: p.request_id, session_key: p.session_key, cmd_hash: p.cmd_hash, scopes: p.scopes,
    ms: p.ms, issued_at: p.issued_at, expires_at: p.expires_at, nonce: p.nonce,
})).digest('base64url');
const rid = () => `r${++seq}${crypto.randomBytes(4).toString('hex')}`;

const enrol = (over = {}, mode = 0o600) => {
    const f = path.join(gdir, 'trail-credential.json');
    const j = auth.publicKeyJwk;
    fs.writeFileSync(f, JSON.stringify({
        v: 1, id: auth.credentialId, publicKey: { kty: j.kty, crv: j.crv, x: j.x, y: j.y }, signCount: 0, created: new Date().toISOString(), origin: ORIGIN, ...over,
    }), { mode });
    fs.chmodSync(f, mode);
    return f;
};

const goPayload = (over = {}) => {
    const now = Date.now();
    return { v: 1, kind: 'go', request_id: rid(), session_key: 's1', cmd_hash: sha(CMD), scopes: ['merge'], ms: 0, issued_at: now, expires_at: now + 10 * MIN - 1000, nonce: crypto.randomBytes(16).toString('hex'), ...over };
};
const grantPayload = (over = {}) => {
    const now = Date.now();
    return { v: 1, kind: 'grant', request_id: `g-${crypto.randomBytes(12).toString('hex')}`, session_key: 's1', cmd_hash: '', scopes: ['merge'], ms: 15 * MIN, issued_at: now, expires_at: now + 15 * MIN, nonce: crypto.randomBytes(16).toString('hex'), ...over };
};
// opts: sign (softauth overrides), tamper(body), mode, name, raw (replace the file content)
const write = (payload, opts = {}) => {
    const body = { payload, assertion: auth.sign(opts.challenge ?? challengeOf(payload), opts.sign || {}) };
    if (opts.tamper) opts.tamper(body);
    const f = path.join(godir, opts.name ?? `${payload.session_key}.click-${payload.request_id}.json`);
    fs.writeFileSync(f, opts.raw ?? JSON.stringify(body), { mode: opts.mode ?? 0o600 });
    fs.chmodSync(f, opts.mode ?? 0o600);
    return f;
};
const receipt = (over, opts) => { enrol(); const p = goPayload(over); return { p, f: write(p, opts) }; };
const grant = (over, opts) => { enrol(); const p = grantPayload(over); return { p, f: write(p, opts) }; };

const human = (text, agoMs = 0) => ({
    type: 'user', uuid: `u${++seq}`, timestamp: new Date(Date.now() - agoMs).toISOString(), message: { role: 'user', content: text },
    origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human',
});
const typed = (text, agoMs) => fs.appendFileSync(t, JSON.stringify(human(text, agoMs)) + '\n');

describe('click receipt, accept and replay', () => {
    test('control: without a receipt the command is denied', () => denied(CMD));

    test('a valid receipt allows the exact command once, then it is consumed', () => {
        const { p } = receipt();
        allowed(CMD);
        assert.match(fs.readFileSync(path.join(godir, '.consumed'), 'utf8'), new RegExp(`click-${p.request_id}`));
        assert.ok(fs.existsSync(path.join(godir, `s1.click-${p.request_id}.json.used`)));
        denied(CMD); // replay
    });

    test('a receipt already on the consumed list is denied', () => {
        const { p } = receipt();
        fs.writeFileSync(path.join(godir, '.consumed'), `x\nclick-${p.request_id}\n`);
        denied(CMD);
    });

    test('a receipt with an existing .used marker is denied', () => {
        const { p } = receipt();
        fs.writeFileSync(path.join(godir, `s1.click-${p.request_id}.json.used`), '');
        denied(CMD);
    });

    test('clickReceiptCovers consume:false verifies without consuming', () => {
        receipt();
        assert.equal(g.clickReceiptCovers(CMD, 's1', { consume: false }), true);
        assert.equal(g.clickReceiptCovers(CMD, 's1', { consume: false }), true);
        assert.equal(g.clickReceiptCovers(CMD, 's1'), true);
        assert.equal(g.clickReceiptCovers(CMD, 's1'), false);
    });

    test('a receipt for another command is denied', () => {
        receipt({ cmd_hash: sha('gh pr merge 6') });
        denied(CMD);
    });

    test('widened command is denied', () => {
        receipt();
        denied(`${CMD} --admin`);
        denied(`${CMD}; gh pr merge 6`);
        allowed(CMD); // the receipt is still intact for the exact command
    });

    test('wrong session is denied', () => {
        receipt({ session_key: 's2' });
        denied(CMD); // runs as s1
    });

    test('payload session differs from the file name session is denied', () => {
        const { p } = receipt({ session_key: 's2' });
        fs.renameSync(path.join(godir, `s2.click-${p.request_id}.json`), path.join(godir, `s1.click-${p.request_id}.json`));
        denied(CMD);
    });

    test('file name that does not match the request id is denied', () => {
        const p = goPayload();
        enrol();
        write(p, { name: 's1.click-other.json' });
        denied(CMD);
    });

    test('expired receipt (older than 10 minutes) is denied', () => {
        const issued = Date.now() - 11 * MIN;
        receipt({ issued_at: issued, expires_at: issued + 10 * MIN - 1000 });
        denied(CMD);
    });

    test('a receipt valid for more than 10 minutes is denied even when signed', () => {
        receipt({ expires_at: Date.now() + 11 * MIN });
        denied(CMD);
    });

    test('a receipt issued in the future is denied', () => {
        const issued = Date.now() + 5 * MIN;
        receipt({ issued_at: issued, expires_at: issued + 9 * MIN });
        denied(CMD);
    });

    test('a receipt issued only seconds ahead of the clock is denied too (no skew allowance)', () => {
        const issued = Date.now() + 30 * 1000;
        receipt({ issued_at: issued, expires_at: issued + 9 * MIN });
        denied(CMD);
    });

    test('a spent receipt does not hide a fresh receipt for the same command', () => {
        const spent = receipt().p;
        fs.writeFileSync(path.join(godir, `s1.click-${spent.request_id}.json.used`), '');
        const fresh = write(goPayload());
        assert.ok(fresh);
        allowed(CMD);
        denied(CMD);
    });

    test('consume:false is false for a spent receipt', () => {
        const { p } = receipt();
        fs.writeFileSync(path.join(godir, `s1.click-${p.request_id}.json.used`), '');
        assert.equal(g.clickReceiptCovers(CMD, 's1', { consume: false }), false);
    });

    test('payload edited after signing is denied', () => {
        receipt({}, { tamper: (b) => { b.payload.expires_at += 60000; } });
        denied(CMD);
    });

    test('command hash edited after signing is denied', () => {
        receipt({ cmd_hash: sha('gh pr merge 6') }, { tamper: (b) => { b.payload.cmd_hash = sha(CMD); } });
        denied(CMD);
    });

    test('an unknown extra payload field is denied', () => {
        receipt({}, { tamper: (b) => { b.payload.extra = 1; } });
        denied(CMD);
    });

    test('signature by another key is denied', () => {
        receipt({}, { sign: { key: auth.otherKey() } });
        denied(CMD);
    });

    test('credential file holding another public key is denied', () => {
        const other = SA.createSoftAuth({ origin: ORIGIN });
        const p = goPayload();
        enrol({ publicKey: { kty: 'EC', crv: 'P-256', x: other.publicKeyJwk.x, y: other.publicKeyJwk.y } });
        write(p);
        denied(CMD);
    });

    test('user verification cleared is denied', () => {
        receipt({}, { sign: { flags: SA.FLAG_UP } });
        denied(CMD);
    });

    test('user presence cleared is denied', () => {
        receipt({}, { sign: { flags: SA.FLAG_UV } });
        denied(CMD);
    });

    test('wrong rpIdHash is denied', () => {
        receipt({}, { sign: { rpId: 'example.com' } });
        denied(CMD);
    });

    test('wrong origin is denied', () => {
        receipt({}, { sign: { origin: 'http://localhost:9999' } });
        denied(CMD);
    });

    test('wrong clientData type is denied', () => {
        receipt({}, { sign: { type: 'webauthn.create' } });
        denied(CMD);
    });

    test('challenge mismatch is denied', () => {
        receipt({}, { sign: { challenge: crypto.randomBytes(32).toString('base64url') } });
        denied(CMD);
    });

    test('assertion for another credential id is denied', () => {
        receipt({}, { tamper: (b) => { b.assertion.id = 'AAAA'; } });
        denied(CMD);
    });
});

describe('click receipt, files and credential', () => {
    test('receipt that is a symlink is denied', () => {
        enrol();
        const p = goPayload();
        const real = write(p, { name: 'real-receipt.json' });
        fs.symlinkSync(real, path.join(godir, `s1.click-${p.request_id}.json`));
        denied(CMD);
    });

    test('receipt with mode 0644 is denied', () => {
        receipt({}, { mode: 0o644 });
        denied(CMD);
    });

    test('receipt with mode 0640 or 0660 is denied', () => {
        receipt({}, { mode: 0o640 });
        receipt({}, { mode: 0o660 });
        denied(CMD);
    });

    test('receipt owned by another user is denied', { skip: typeof process.getuid === 'function' && process.getuid() !== 0 ? 'needs root to chown' : false }, () => {
        const { f } = receipt();
        fs.chownSync(f, 12345, 12345);
        denied(CMD);
    });

    test('missing credential file is denied', () => {
        const p = goPayload();
        write(p);
        denied(CMD);
    });

    test('credential file with mode 0644 is denied', () => {
        const p = goPayload();
        enrol({}, 0o644);
        write(p);
        denied(CMD);
    });

    test('credential file without a localhost origin is denied', () => {
        const p = goPayload();
        enrol({ origin: undefined });
        write(p);
        denied(CMD);
        enrol({ origin: 'https://evil.example' });
        denied(CMD);
    });

    test('credential file that is a symlink is denied', () => {
        const p = goPayload();
        const f = enrol();
        fs.renameSync(f, path.join(home, 'real-credential.json'));
        fs.symlinkSync(path.join(home, 'real-credential.json'), f);
        write(p);
        denied(CMD);
    });

    test('a FIFO planted as receipt does not hang the gate', () => {
        enrol();
        const m = spawnSync('mkfifo', [path.join(godir, 's1.click-fifo1.json')]);
        assert.equal(m.status, 0);
        denied(CMD);
        write(goPayload()); // a real receipt next to the FIFO still works
        allowed(CMD);
    });

    test('a FIFO planted as credential does not hang the gate', () => {
        const p = goPayload();
        write(p);
        const m = spawnSync('mkfifo', [path.join(gdir, 'trail-credential.json')]);
        assert.equal(m.status, 0);
        denied(CMD);
    });

    test('a FIFO planted as revoke file does not hang the gate and revokes', () => {
        receipt();
        const m = spawnSync('mkfifo', [path.join(gdir, 's1.revoke.json')]);
        assert.equal(m.status, 0);
        denied(CMD);
    });

    test('oversized receipt is ignored', () => {
        enrol();
        const p = goPayload();
        const body = { payload: p, assertion: auth.sign(challengeOf(p)), pad: 'x'.repeat(20000) };
        write(p, { raw: JSON.stringify(body) });
        denied(CMD);
    });

    test('garbage receipts are denied without a crash', () => {
        enrol();
        fs.writeFileSync(path.join(godir, 's1.click-g1.json'), crypto.randomBytes(300), { mode: 0o600 });
        fs.writeFileSync(path.join(godir, 's1.click-g2.json'), '[]', { mode: 0o600 });
        fs.writeFileSync(path.join(godir, 's1.click-g3.json'), '{"payload":null,"assertion":null}', { mode: 0o600 });
        const p = goPayload();
        write(p, { tamper: (b) => { b.assertion.signature = 'AAAA'; b.assertion.authenticatorData = 'AAAA'; } });
        const q = goPayload();
        write(q, { tamper: (b) => { b.assertion.signature = b.assertion.signature.slice(0, 20); } });
        const r = goPayload();
        write(r, { tamper: (b) => { b.assertion.clientDataJSON = Buffer.from('not json').toString('base64url'); } });
        const s = goPayload();
        write(s, { tamper: (b) => { b.assertion.signature = '!!!not-base64url!!!'; } });
        const res = runGate(CMD);
        assert.equal(res.status, 2);
        assert.doesNotMatch(res.stderr, /internal error/);
    });
});

describe('click receipt never lifts a block', () => {
    test('hard block still wins over a valid receipt', () => {
        const hardCmd = 'rm -rf ~';
        enrol();
        write(goPayload({ cmd_hash: sha(hardCmd) }));
        const r = runGate(hardCmd);
        assert.equal(r.status, 2);
        assert.ok(g.hardBlockReason(hardCmd));
    });

    test('gateStoreReason still wins over a valid receipt', () => {
        const storeCmd = 'echo x > ~/.aos/go/note.txt';
        assert.ok(g.gateStoreReason(storeCmd));
        enrol();
        write(goPayload({ cmd_hash: sha(storeCmd) }));
        denied(storeCmd);
    });

    test('a revoke file closes a go receipt issued before it', () => {
        receipt();
        fs.writeFileSync(path.join(gdir, 's1.revoke.json'), JSON.stringify({ ts: new Date(Date.now() + 1000).toISOString() }), { mode: 0o600 });
        denied(CMD);
    });

    test('a revoke file older than the receipt does not close it', () => {
        fs.writeFileSync(path.join(gdir, 's1.revoke.json'), JSON.stringify({ ts: new Date(Date.now() - 5000).toISOString() }), { mode: 0o600 });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); // ctime of the revoke file counts: the receipt must be later, but never in the future
        const issued = Date.now();
        receipt({ issued_at: issued, expires_at: issued + 10 * MIN - 1000 });
        allowed(CMD);
    });
});

describe('click grant receipts', () => {
    test('control: no grant, merge is denied', () => denied(CMD));

    test('a valid grant covers its scope only', () => {
        grant();
        allowed(CMD);
        allowed(CMD); // grants are not single use
        denied('npm publish');
        denied('git reset --hard HEAD~1');
    });

    test('a multi-scope grant covers each scope', () => {
        grant({ scopes: ['merge', 'publish'] });
        allowed(CMD);
        allowed('npm publish');
    });

    test('a grant covers the scope only until `until`', () => {
        const issued = Date.now() - 20 * MIN;
        grant({ issued_at: issued, expires_at: issued + 15 * MIN });
        denied(CMD);
    });

    test('until is clamped to issued_at + ms even when expires_at is later', () => {
        const issued = Date.now() - 5 * MIN;
        grant({ issued_at: issued, ms: 15 * MIN, expires_at: issued + 2 * 60 * MIN });
        const eff = g.effectiveGate('s1', { source: t, cmds: [] });
        assert.equal(eff.grants.length, 1);
        assert.equal(eff.grants[0].until, issued + 15 * MIN);
        const old = Date.now() - 20 * MIN;
        grant({ issued_at: old, ms: 15 * MIN, expires_at: old + 2 * 60 * MIN, scopes: ['publish'] });
        denied('npm publish');
    });

    test('until is clamped to expires_at when that is earlier than issued_at + ms', () => {
        const issued = Date.now();
        grant({ issued_at: issued, ms: 2 * 60 * MIN, expires_at: issued + 5 * MIN });
        assert.equal(g.effectiveGate('s1', { source: t, cmds: [] }).grants[0].until, issued + 5 * MIN);
    });

    test('a duration over the 24h cap is rejected', () => {
        const issued = Date.now();
        grant({ ms: 25 * 60 * MIN, issued_at: issued, expires_at: issued + 25 * 60 * MIN });
        denied(CMD);
        assert.equal(g.effectiveGate('s1', { source: t, cmds: [] }).grants.length, 0);
    });

    test('24h is accepted, and an OpenCode session is clamped to 2h', () => {
        const issued = Date.now();
        grant({ ms: g.MAX_GRANT_MS, issued_at: issued, expires_at: issued + g.MAX_GRANT_MS });
        assert.equal(g.effectiveGate('s1', { source: t, cmds: [] }).grants[0].until, issued + g.MAX_GRANT_MS);
        assert.equal(g.effectiveGate('s1', { source: t, cmds: [], opencode: true }).grants[0].until, issued + g.OPENCODE_MAX_GRANT_MS);
    });

    test('scopes parseGogateArgs would reject are rejected', () => {
        for (const scopes of [['bogus'], ['merge', 'bogus'], ['MERGE'], ['merge', 'merge'], ['merge,publish'], []]) {
            grant({ scopes });
        }
        assert.equal(g.effectiveGate('s1', { source: t, cmds: [] }).grants.length, 0);
        denied(CMD);
        denied('npm publish');
    });

    test('a grant receipt carrying a command hash is rejected', () => {
        grant({ cmd_hash: sha(CMD) });
        denied(CMD);
    });

    test('a go receipt is not a grant and a grant receipt is not a go receipt', () => {
        const p = grantPayload({ cmd_hash: '' });
        enrol();
        write({ ...p, kind: 'go', request_id: p.request_id });
        assert.equal(g.effectiveGate('s1', { source: t, cmds: [] }).grants.length, 0);
        denied(CMD);
        grant();
        assert.equal(g.clickReceiptCovers(CMD, 's1'), false);
    });

    test('tampered, wrongly signed and unsigned-user-verification grants are rejected', () => {
        grant({}, { tamper: (b) => { b.payload.scopes = ['merge', 'publish']; } });
        grant({}, { sign: { key: auth.otherKey() } });
        grant({}, { sign: { flags: SA.FLAG_UP } });
        grant({}, { mode: 0o644 });
        denied(CMD);
    });

    test('a grant for another session does not apply', () => {
        grant({ session_key: 's2' });
        denied(CMD);
    });

    test('a later typed hard closes click grants', () => {
        grant({ issued_at: Date.now() - 10000, expires_at: Date.now() + 15 * MIN - 10000 });
        typed('gogate hard');
        denied(CMD);
        const cmds = g.claudeGogateCommands(t);
        assert.equal(cmds.length, 1);
        assert.equal(g.effectiveGate('s1', { source: t, cmds }).grants.length, 0);
    });

    test('a typed hard older than the grant does not close it', () => {
        typed('gogate hard', 60000);
        grant();
        const cmds = g.claudeGogateCommands(t);
        assert.equal(cmds.length, 1);
        assert.equal(g.effectiveGate('s1', { source: t, cmds }).grants.length, 1);
    });

    test('a revoke file closes click grants issued before it, not after', () => {
        const rev = path.join(gdir, 's1.revoke.json');
        grant({ issued_at: Date.now() - 10000, expires_at: Date.now() + 15 * MIN - 10000 });
        allowed(CMD);
        fs.writeFileSync(rev, JSON.stringify({ ts: new Date().toISOString() }), { mode: 0o600 });
        denied(CMD);
        const eff = g.effectiveGate('s1', { source: t, cmds: [] });
        assert.equal(eff.mode, 'hard');
        assert.equal(eff.grants.length, 0);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); // later than the revoke file's ctime, never in the future
        grant({ issued_at: Date.now(), expires_at: Date.now() + 16 * MIN });
        assert.equal(g.effectiveGate('s1', { source: t, cmds: [] }).grants.length, 1);
    });

    test('a malformed or future-dated revoke file revokes now', () => {
        grant();
        fs.writeFileSync(path.join(gdir, 's1.revoke.json'), 'not json', { mode: 0o600 });
        assert.equal(g.effectiveGate('s1', { source: t, cmds: [] }).grants.length, 0);
        fs.writeFileSync(path.join(gdir, 's1.revoke.json'), JSON.stringify({ ts: '2999-01-01T00:00:00Z' }), { mode: 0o600 });
        assert.equal(g.effectiveGate('s1', { source: t, cmds: [] }).grants.length, 0);
    });

    test('without a revoke file effectiveGate is unchanged', () => {
        const eff = g.effectiveGate('s1', { source: t, cmds: [] });
        assert.deepEqual(eff, { mode: 'soft', grants: [], rejected: [] });
    });
});

describe('round 2: click limits', () => {
    const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

    test('an over-length command is not covered by a click', () => {
        const long = `gh pr merge 5 # ${'x'.repeat(17000)}`;
        receipt({ cmd_hash: sha(long) });
        assert.equal(g.clickReceiptCovers(long, 's1', { consume: false }), false);
        denied(long);
    });

    test('a click does not lift the block cooldown', () => {
        const fresh = path.join(repo, 'edit.py');
        fs.writeFileSync(path.join(gdir, 's1.block'), JSON.stringify({ ts: Date.now() }));
        sleep(60);
        fs.writeFileSync(fresh, 'print("harmless")');
        const cmd = `python3 ${fresh}`;
        receipt({ cmd_hash: sha(cmd) });
        const r = runGate(cmd);
        assert.equal(r.status, 2);
        assert.match(r.stdout + r.stderr, /blocked recently|cooldown/);
    });

    test('whitespace and newline variants of a clicked command are denied', () => {
        receipt();
        for (const variant of [`${CMD}\n`, ` ${CMD}`, 'gh  pr merge 5', 'gh pr merge\n5', 'gh\tpr merge 5', `${CMD}\r\n`]) {
            assert.equal(g.clickReceiptCovers(variant, 's1', { consume: false }), false, JSON.stringify(variant));
        }
        for (const variant of [`${CMD}\n`, 'gh  pr merge 5', 'gh pr merge\n5']) denied(variant);
        allowed(CMD); // the exact normal form still works
    });

    test('overwriting a revoke file with an old timestamp still closes grants', () => {
        const rev = path.join(gdir, 's1.revoke.json');
        grant({ issued_at: Date.now() - 10000, expires_at: Date.now() + 15 * MIN - 10000 });
        allowed(CMD);
        fs.writeFileSync(rev, JSON.stringify({ ts: '1970-01-01T00:00:00Z' }), { mode: 0o600 });
        fs.utimesSync(rev, 0, 0);
        denied(CMD);
        assert.equal(g.effectiveGate('s1', { source: t, cmds: [] }).grants.length, 0);
        fs.writeFileSync(rev, JSON.stringify({ ts: new Date(Date.now() - 3600e3).toISOString() }), { mode: 0o600 });
        fs.utimesSync(rev, 0, 0);
        denied(CMD);
        fs.writeFileSync(rev, '{}', { mode: 0o600 });
        fs.utimesSync(rev, 0, 0);
        denied(CMD);
    });

    test('commands over 200 chars, non-ASCII or containing secrets are not covered by a click', () => {
        for (const cmd of [`gh pr merge 5 # ${'x'.repeat(200)}`, 'gh pr merge 5 # café', 'gh pr merge 5 --token abc123']) {
            receipt({ cmd_hash: sha(cmd) });
            assert.equal(g.clickEligible(cmd), false, cmd);
            assert.equal(g.clickReceiptCovers(cmd, 's1', { consume: false }), false, cmd);
        }
        assert.equal(g.clickEligible(CMD), true);
    });
});

describe('verifyWebAuthnAssertion', () => {
    const credential = () => ({ id: auth.credentialId, publicKey: { kty: 'EC', crv: 'P-256', x: auth.publicKeyJwk.x, y: auth.publicKeyJwk.y } });
    const CH = crypto.randomBytes(32).toString('base64url');
    const verify = (assertion, extra = {}) => g.verifyWebAuthnAssertion({ credential: credential(), assertion, expectedChallenge: CH, origin: ORIGIN, ...extra });

    test('accepts a good assertion and reports the counter', () => {
        const r = verify(auth.sign(CH));
        assert.equal(r.ok, true);
        assert.equal(r.signCount, 1);
    });

    test('rejects each defect with ok:false and never throws', () => {
        const bad = [
            auth.sign(CH, { flags: SA.FLAG_UP }), auth.sign(CH, { flags: SA.FLAG_UV }), auth.sign(CH, { rpId: 'x.test' }), auth.sign(CH, { origin: 'http://localhost:1' }),
            auth.sign(CH, { type: 'webauthn.create' }), auth.sign('other'), auth.sign(CH, { key: auth.otherKey() }),
            { ...auth.sign(CH), id: 'nope' }, { ...auth.sign(CH), signature: 'AAAA' }, { ...auth.sign(CH), authenticatorData: 'AAAA' },
            {}, null, 'x', { id: auth.credentialId },
        ];
        for (const a of bad) assert.equal(verify(a).ok, false);
        assert.equal(verify(auth.sign(CH), { credential: null }).ok, false);
        assert.equal(verify(auth.sign(CH), { credential: { id: auth.credentialId, publicKey: { kty: 'EC', crv: 'P-256', x: 'AAAA', y: 'AAAA' } } }).ok, false);
        assert.equal(verify(auth.sign(CH), { credential: { id: auth.credentialId, publicKey: { kty: 'RSA' } } }).ok, false);
        assert.equal(verify(auth.sign(CH), { expectedChallenge: '' }).ok, false);
        assert.equal(g.verifyWebAuthnAssertion().ok, false);
    });

    test('a hub-style signature over a custom rpId verifies against that rpId only', () => {
        const a = SA.createSoftAuth({ origin: ORIGIN, rpId: 'example.com' });
        const cred = { id: a.credentialId, publicKey: { kty: 'EC', crv: 'P-256', x: a.publicKeyJwk.x, y: a.publicKeyJwk.y } };
        const s = a.sign(CH);
        assert.equal(g.verifyWebAuthnAssertion({ credential: cred, assertion: s, expectedChallenge: CH, origin: ORIGIN, rpId: 'example.com' }).ok, true);
        assert.equal(g.verifyWebAuthnAssertion({ credential: cred, assertion: s, expectedChallenge: CH, origin: ORIGIN }).ok, false);
    });
});

describe('parseCoseKey', () => {
    test('extracts the credential id and the P-256 key from an attestationObject', () => {
        const att = AT.attestationObject(auth);
        const r = g.parseCoseKey(att);
        assert.equal(r.credentialId, auth.credentialId);
        assert.deepEqual(r.publicKey, { kty: 'EC', crv: 'P-256', x: auth.publicKeyJwk.x, y: auth.publicKeyJwk.y });
        assert.deepEqual(g.parseCoseKey(att.toString('base64url')), r);
        assert.deepEqual(g.parseCoseKey(new Uint8Array(att)), r);
    });

    test('the extracted key verifies an assertion of the same authenticator', () => {
        const { credentialId, publicKey } = g.parseCoseKey(AT.attestationObject(auth));
        const a = auth.sign('chal');
        assert.equal(g.verifyWebAuthnAssertion({ credential: { id: credentialId, publicKey }, assertion: a, expectedChallenge: 'chal', origin: ORIGIN }).ok, true);
    });

    test('malformed input returns null and never throws', () => {
        const att = AT.attestationObject(auth);
        const nest = Buffer.concat([...Array(12).fill(Buffer.from([0xa1, 0x01])), Buffer.from([0x00])]);
        const cases = [
            null, undefined, 42, {}, [], '', 'not base64url!!', Buffer.alloc(0), Buffer.from([0xff]), crypto.randomBytes(200),
            Buffer.from([0xbf, 0xff]), // indefinite map
            Buffer.from([0x5f, 0xff]), // indefinite bytes
            Buffer.from([0x7f, 0xff]), // indefinite text
            Buffer.from([0x9f, 0xff]), // indefinite array
            Buffer.from([0xa1, 0x41, 0x61, 0x5a, 0xff, 0xff, 0xff, 0xff]), // 4 GiB byte string claim
            Buffer.from([0xa1, 0x01, 0x1b, 0, 0, 0, 1, 0, 0, 0, 0]), // 64-bit integer
            Buffer.from([0xa2, 0x01, 0x01, 0x01, 0x02]), // duplicate key
            Buffer.from([0xa1, 0x81, 0x01, 0x01]), // array as key
            Buffer.from([0xc1, 0x01]), // tag
            Buffer.from([0xf9, 0x3c, 0x00]), // float
            Buffer.from([0xa1, 0x61, 0x66, 0x81, 0x00]), // array value
            nest, // nesting deeper than the cap
            Buffer.concat([att, Buffer.from([0x00])]), // trailing byte
            AT.attestationObject(auth, { fmt: 'packed' }),
            AT.attestationObject(auth, { attStmt: new Map([['alg', -7]]) }),
            AT.attestationObject(auth, { flags: 0x05 }), // no attested-credential-data flag
            AT.attestationObject(auth, { authData: Buffer.alloc(54) }),
            AT.attestationObject(auth, { authData: Buffer.concat([Buffer.alloc(32), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0xff, 0xff])]) }),
        ];
        for (const c of cases) assert.equal(g.parseCoseKey(c), null);
        for (let k = 0; k < att.length; k += 7) assert.equal(g.parseCoseKey(att.subarray(0, k)), null, `truncated at ${k}`);
    });

    test('a COSE key that is not ES256 / P-256 or is off the curve is rejected', () => {
        const j = auth.publicKeyJwk;
        const x = Buffer.from(j.x, 'base64url'), y = Buffer.from(j.y, 'base64url');
        const mk = (entries) => {
            const credId = Buffer.from(auth.credentialId, 'base64url');
            const idLen = Buffer.alloc(2);
            idLen.writeUInt16BE(credId.length);
            const ad = Buffer.concat([Buffer.alloc(32), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), idLen, credId, AT.cbor(new Map(entries))]);
            return AT.attestationObject(auth, { authData: ad });
        };
        assert.notEqual(g.parseCoseKey(mk([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, y]])), null);
        assert.equal(g.parseCoseKey(mk([[1, 3], [3, -7], [-1, 1], [-2, x], [-3, y]])), null); // kty RSA
        assert.equal(g.parseCoseKey(mk([[1, 2], [3, -257], [-1, 1], [-2, x], [-3, y]])), null); // alg RS256
        assert.equal(g.parseCoseKey(mk([[1, 2], [3, -7], [-1, 2], [-2, x], [-3, y]])), null); // P-384
        assert.equal(g.parseCoseKey(mk([[1, 2], [3, -7], [-1, 1], [-2, x.subarray(1)], [-3, y]])), null); // short x
        assert.equal(g.parseCoseKey(mk([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, Buffer.alloc(32, 7)]])), null); // off curve
        assert.equal(g.parseCoseKey(mk([[1, 2], [3, -7], [-1, 1], [-2, x]])), null); // missing y
    });
});
