// `aos-gateway adopt`: scan + apply over temp-home fixtures. No network, no real home.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { gatewayDir } = require('../lib/gateway/config.js');
const harness = require('../lib/gateway/harness.js');
const adopt = require('../lib/gateway/adopt.js');
const { fromOpencode } = require('../lib/mcp-secrets.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-adopt-'));
const mode = (p) => fs.statSync(p).mode & 0o777;
const posix = process.platform !== 'win32';
const TOKEN = 'e'.repeat(64);
const shipped = require('../lib/mcp-secrets.js').shippedServers(ROOT);

const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function fixture(extra = {}) {
    const home = tmp();
    const f = {
        claude: path.join(home, '.claude.json'),
        cursor: path.join(home, '.cursor', 'mcp.json'),
        oc: path.join(home, '.config', 'opencode', 'opencode.json'),
    };
    wj(f.claude, { numStartups: 2, projects: { '/x': { mcpServers: { keepme: { command: 'node', args: ['p.js'] } } } }, mcpServers: {
        mine: { command: 'node', args: ['mine.js'], cwd: '/w', env: { FOO: 'bar' } },
        ...extra.claude,
    } });
    wj(f.cursor, { mcpServers: { mine2: { command: 'uvx', args: ['tool'] }, ...extra.cursor } });
    wj(f.oc, { $schema: 'x', mcp: { ocmine: { type: 'local', command: ['node', 'oc.js'] }, ...extra.oc } });
    const files = [{ file: f.claude, kind: 'json' }, { file: f.cursor, kind: 'json' }, { file: f.oc, kind: 'opencode' }];
    return { home, f, files };
}

test('stdio entry adopted, removed from harness file, aos added, adopted.json correct', () => {
    const fx = fixture();
    const rep = adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped, now: 1000 });
    assert.deepEqual(rep.adopted, ['mine', 'mine2', 'ocmine']);
    const c = rj(fx.f.claude);
    assert.equal(c.mcpServers.mine, undefined);
    assert.deepEqual(c.mcpServers.aos, { type: 'http', url: harness.GATEWAY_URL, headers: { 'X-AOS-Token': TOKEN } });
    assert.equal(c.numStartups, 2);
    assert.deepEqual(c.projects['/x'].mcpServers.keepme, { command: 'node', args: ['p.js'] }, 'project-level servers untouched');
    const cur = rj(fx.f.cursor);
    assert.deepEqual(cur.mcpServers.aos, { url: harness.GATEWAY_URL, headers: { 'X-AOS-Token': TOKEN } });
    const oc = rj(fx.f.oc);
    assert.deepEqual(oc.mcp.aos, { type: 'remote', url: harness.GATEWAY_URL, headers: { 'X-AOS-Token': TOKEN }, enabled: true });
    const afile = adopt.adoptedPath(fx.home);
    const ad = rj(afile);
    if (posix) assert.equal(mode(afile), 0o600);
    assert.equal(ad.version, 1);
    assert.deepEqual(ad.servers.mine, { command: 'node', args: ['mine.js'], cwd: '/w', env: { FOO: 'bar' }, from: [fx.f.claude], at: 1000 });
    assert.equal(ad.servers.ocmine.command, 'node');
    assert.ok(ad.servers.ocmine.args[0] !== undefined || Array.isArray(ad.servers.ocmine.args) === false);
    assert.ok(fs.existsSync(path.join(gatewayDir(fx.home), 'adopted.json')));
    // migration records exist so disable can restore
    const recs = harness.readMigration(fx.home);
    assert.ok(recs.some((r) => r.key === 'mine' && r.kind === 'claude'));
});

test('scan: opencode array-form entry is normalized', () => {
    const fx = fixture();
    const s = adopt.scanAdoptable({ files: fx.files, shipped });
    const o = s.adoptable.find((a) => a.name === 'ocmine');
    assert.deepEqual(o.entry, { command: 'node', args: ['oc.js'], env: {} });
});

test('http entry skipped', () => {
    const fx = fixture({ claude: { remote: { url: 'http://x/y', headers: {} } } });
    const s = adopt.scanAdoptable({ files: fx.files, shipped });
    assert.ok(s.skipped.some((k) => k.name === 'remote' && /remote/.test(k.reason)));
    const rep = adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped });
    assert.ok(!rep.adopted.includes('remote'));
    assert.ok(rj(fx.f.claude).mcpServers.remote);
});

test('inline secret skipped and file untouched', () => {
    const fx = fixture({ cursor: { secrety: { command: 'node', args: ['s.js'], env: { SOME_TOKEN: 'sk-realvalue-abc123' } } } });
    const rep = adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped });
    assert.ok(rep.skipped.some((k) => k.name === 'secrety' && k.reason === 'inline-secret'));
    assert.ok(rj(fx.f.cursor).mcpServers.secrety, 'the inline-secret entry stays in the cursor file');
    assert.ok(rj(adopt.adoptedPath(fx.home)).servers.secrety === undefined);
    assert.ok(!fs.readFileSync(adopt.adoptedPath(fx.home), 'utf8').includes('sk-realvalue'));
    // cursor still gets the aos entry though
    assert.ok(rj(fx.f.cursor).mcpServers.aos);
});

test('name in GATEWAY_SERVERS / DIRECT_SERVERS / shipped skipped', () => {
    const fx = fixture({ claude: { deja: { command: 'deja', args: ['mcp'] }, github: { command: 'npx', args: ['-y', 'gh'] } } });
    const rep = adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped });
    assert.ok(rep.skipped.some((k) => k.name === 'deja' && /handled/.test(k.reason)));
    assert.ok(rep.skipped.some((k) => k.name === 'github' && /handled/.test(k.reason)));
    assert.ok(rj(fx.f.claude).mcpServers.deja);
});

test('invalid or too-long names skipped', () => {
    const fx = fixture({ claude: { 'bad name!': { command: 'node', args: ['x'] }, [ 'n'.repeat(27) ]: { command: 'node', args: ['y'] } } });
    const rep = adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped });
    assert.ok(rep.skipped.some((k) => k.name === 'bad name!' && /invalid/.test(k.reason)));
    assert.ok(rep.skipped.some((k) => /invalid/.test(k.reason) && k.name.length === 27));
    const ad = rj(adopt.adoptedPath(fx.home));
    for (const n of Object.keys(ad.servers)) assert.match(n, /^[A-Za-z0-9_-]+$/);
});

test('same entry in two files adopted once with two sources', () => {
    const home = tmp();
    const f1 = path.join(home, '.claude.json');
    const f2 = path.join(home, '.cursor', 'mcp.json');
    const e = { command: 'node', args: ['same.js'], env: { A: '1' } };
    wj(f1, { mcpServers: { sister: e } });
    wj(f2, { mcpServers: { sister: e } });
    const rep = adopt.applyAdopt({ home, token: TOKEN, files: [{ file: f1, kind: 'json' }, { file: f2, kind: 'json' }], shipped });
    assert.deepEqual(rep.adopted, ['sister']);
    const ad = rj(adopt.adoptedPath(home));
    assert.equal(ad.servers.sister.from.length, 2);
    const recs = harness.readMigration(home).filter((r) => r.key === 'sister');
    assert.equal(recs.length, 2, 'one migration record per file');
    assert.equal(rj(f1).mcpServers.sister, undefined);
    assert.equal(rj(f2).mcpServers.sister, undefined);
});

test('conflicting definitions skipped', () => {
    const home = tmp();
    const f1 = path.join(home, '.claude.json');
    const f2 = path.join(home, '.cursor', 'mcp.json');
    wj(f1, { mcpServers: { twin: { command: 'node', args: ['a.js'] } } });
    wj(f2, { mcpServers: { twin: { command: 'node', args: ['b.js'] } } });
    const s = adopt.scanAdoptable({ files: [{ file: f1, kind: 'json' }, { file: f2, kind: 'json' }], shipped });
    const sk = s.skipped.filter((k) => k.name === 'twin');
    assert.equal(sk.length, 2);
    for (const k of sk) assert.match(k.reason, /conflicting/);
    const rep = adopt.applyAdopt({ home, token: TOKEN, files: [{ file: f1, kind: 'json' }, { file: f2, kind: 'json' }], shipped });
    assert.ok(!rep.adopted.includes('twin'));
    assert.ok(rj(f1).mcpServers.twin);
});

test('disabled and launcher entries skipped', () => {
    const fx = fixture({ claude: { off: { command: 'node', args: ['x'], disabled: true }, lanch: { command: 'node', args: [path.join('bin', 'aos-mcp-env.mjs'), '--vars', '', '--', 'node', 'z.js'] } }, oc: { oc_off: { type: 'local', command: ['n', 'y'], enabled: false } } });
    const s = adopt.scanAdoptable({ files: fx.files, shipped });
    assert.ok(s.skipped.some((k) => k.name === 'off' && /disabled/.test(k.reason)));
    assert.ok(s.skipped.some((k) => k.name === 'oc_off' && /disabled/.test(k.reason)));
    assert.ok(s.skipped.some((k) => k.name === 'lanch' && /managed/.test(k.reason)));
});

test('dryRun returns the scan, writes nothing', () => {
    const fx = fixture();
    const before = fx.files.map((f) => fs.readFileSync(f.file, 'utf8'));
    const rep = adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped, dryRun: true });
    assert.equal(rep.dryRun, true);
    assert.ok(rep.adoptable.length >= 3);
    assert.ok(!fs.existsSync(adopt.adoptedPath(fx.home)));
    assert.deepEqual(fx.files.map((f) => fs.readFileSync(f.file, 'utf8')), before);
});

test('only adopts just the listed names', () => {
    const fx = fixture();
    const rep = adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped, only: ['mine2'] });
    assert.deepEqual(rep.adopted, ['mine2']);
    assert.deepEqual(rj(fx.f.claude).mcpServers.mine, { command: 'node', args: ['mine.js'], cwd: '/w', env: { FOO: 'bar' } });
    assert.equal(rj(fx.f.claude).mcpServers.aos, undefined, 'untouched file gets no aos entry');
    assert.equal(rj(fx.f.oc).mcp.ocmine.command[0], 'node');
    assert.deepEqual(Object.keys(rj(adopt.adoptedPath(fx.home)).servers), ['mine2']);
});

test('idempotent second run adopts nothing', () => {
    const fx = fixture();
    adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped, now: 1000 });
    const snap1 = adopt.adoptedPath(fx.home);
    const ad1 = fs.readFileSync(snap1, 'utf8');
    const mig1 = fs.readFileSync(harness.migrationPath(fx.home), 'utf8');
    const rep = adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped, now: 2000 });
    assert.equal(rep.adopted.length, 0);
    assert.equal(fs.readFileSync(snap1, 'utf8'), ad1);
    assert.equal(fs.readFileSync(harness.migrationPath(fx.home), 'utf8'), mig1);
    assert.ok(rep.files.every((r) => !r.changed));
});

test('harness.disable restores the original entries (round trip)', () => {
    const fx = fixture();
    const before = fx.files.map((f) => fs.readFileSync(f.file, 'utf8'));
    adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped, now: 1000 });
    const rep = harness.disable({ home: fx.home, files: fx.files, now: 3000 });
    assert.ok(rep.length >= 3);
    assert.deepEqual(fx.files.map((f) => fs.readFileSync(f.file, 'utf8')), before, 'originals restored byte-identical');
    const c = rj(fx.f.claude);
    assert.deepEqual(c.mcpServers.mine, { command: 'node', args: ['mine.js'], cwd: '/w', env: { FOO: 'bar' } });
    assert.equal(rj(fx.f.cursor).mcpServers.mine2.command, 'uvx');
    const oc = rj(fx.f.oc);
    assert.deepEqual(fromOpencode(oc.mcp.ocmine), { command: 'node', args: ['oc.js'], env: undefined });
});

test('existing adopted entries of other names are kept; same name with a different definition is not overwritten', () => {
    const fx = fixture();
    const dir = gatewayDir(fx.home);
    fs.mkdirSync(dir, { recursive: true });
    const mine = { name0: { command: 'pre', args: [], env: {}, from: [fx.f.cursor], at: 5 }, same: { command: 'pre2', args: ['x'], env: {}, from: [], at: 5 } };
    wj(adopt.adoptedPath(fx.home), { version: 1, servers: mine });
    // a name that will also appear in a harness file with a different definition
    wj(fx.f.claude, { mcpServers: { same: { command: 'new', args: ['y'] }, other: { command: 'o.js' } } });
    const rep = adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped });
    const ad = rj(adopt.adoptedPath(fx.home));
    assert.deepEqual(ad.servers.name0, mine.name0, 'unrelated existing entry kept');
    assert.deepEqual(ad.servers.same, mine.same, 'not overwritten');
    assert.ok(!rep.adopted.includes('same'));
    assert.ok(rep.adopted.includes('other'));
    assert.ok(rep.skipped.some((k) => k.name === 'same' && /already adopted with a different definition/.test(k.reason)));
});

test('user-owned aos entry blocks that file only', () => {
    const fx = fixture();
    wj(fx.f.claude, { numStartups: 2, mcpServers: { mine: { command: 'node', args: ['mine.js'] }, aos: { command: 'node', args: ['my-aos.js'] } } });
    const before = fs.readFileSync(fx.f.claude, 'utf8');
    const rep = adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped });
    assert.equal(fs.readFileSync(fx.f.claude, 'utf8'), before);
    assert.ok(rep.skipped.some((k) => k.name === 'mine' && /user-owned "aos"/.test(k.reason)), 'reported as skipped');
    assert.ok(rj(fx.f.cursor).mcpServers.aos, 'other files proceed');
    assert.ok(rj(fx.f.claude).mcpServers.mine, 'entry stays where the file was blocked');
});

test('invalid token refused unless dryRun', () => {
    const fx = fixture();
    assert.throws(() => adopt.applyAdopt({ home: fx.home, token: 'short', files: fx.files, shipped }), /token/);
    assert.ok(!fs.existsSync(adopt.adoptedPath(fx.home)));
    const r = adopt.applyAdopt({ home: fx.home, token: 'short', files: fx.files, shipped, dryRun: true });
    assert.equal(r.dryRun, true);
});

test('scan ignores absent files but reports unreadable/bad ones as skipped', () => {
    const home = tmp();
    const good = path.join(home, '.claude.json');
    wj(good, { mcpServers: { fine: { command: 'node', args: [] } } });
    const bad = path.join(home, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(bad), { recursive: true });
    fs.writeFileSync(bad, '{ // comments\n "mcpServers": {} }\n');
    const s = adopt.scanAdoptable({ files: [{ file: good, kind: 'json' }, { file: bad, kind: 'json' }, { file: path.join(home, 'gone', 'x.json'), kind: 'json' }], shipped });
    assert.ok(s.adoptable.some((a) => a.name === 'fine'));
    assert.ok(s.skipped.some((k) => k.file === bad && /not plain JSON/.test(k.reason)));
    assert.ok(s.skipped.some((k) => k.file === path.join(home, 'gone', 'x.json') && /shape/.test(k.reason)));
});

test('secrets in arguments or secret-named env are never adopted', () => {
    const fx = fixture({ claude: {
        argkey: { command: 'node', args: ['s.js', '--api-key=abc123'] },
        urlcred: { command: 'node', args: ['s.js', 'https://u:pw@example.com/x'] },
        awsy: { command: 'node', args: ['s.js'], env: { AWS_SECRET_ACCESS_KEY: 'xyz' } },
        refy: { command: 'node', args: ['s.js'], env: { API_KEY: '${API_KEY}' } },
    } });
    const s = adopt.scanAdoptable({ files: fx.files, shipped });
    for (const n of ['argkey', 'urlcred', 'awsy', 'refy']) {
        assert.ok(s.skipped.some((k) => k.name === n && /inline-secret/.test(k.reason)), n);
        assert.ok(!s.adoptable.some((a) => a.name === n), n);
    }
});

test('reserved prototype names are not adopted', () => {
    const fx = fixture();
    fs.writeFileSync(fx.f.cursor, '{"mcpServers":{"__proto__":{"command":"node","args":["x"]},"constructor":{"command":"node","args":["y"]}}}');
    const s = adopt.scanAdoptable({ files: fx.files, shipped });
    assert.ok(!s.adoptable.some((a) => a.name === '__proto__' || a.name === 'constructor'));
});

test('a corrupt adopted.json aborts before anything is changed', () => {
    const fx = fixture();
    const dir = gatewayDir(fx.home);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'adopted.json'), '{not json');
    const before = fs.readFileSync(fx.f.claude, 'utf8');
    assert.throws(() => adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped }), /not valid JSON/);
    assert.equal(fs.readFileSync(fx.f.claude, 'utf8'), before);
    assert.equal(fs.readFileSync(path.join(dir, 'adopted.json'), 'utf8'), '{not json');
});

test('a user-owned aos entry blocks the file and the name is not left in adopted.json', () => {
    const fx = fixture();
    wj(fx.f.claude, { mcpServers: { mine: { command: 'node', args: ['mine.js'] }, aos: { command: 'keep' } } });
    const rep = adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped });
    assert.ok(!rep.adopted.includes('mine'));
    assert.ok(rj(fx.f.claude).mcpServers.mine);
    const a = fs.existsSync(adopt.adoptedPath(fx.home)) ? rj(adopt.adoptedPath(fx.home)).servers : {};
    assert.equal(a.mine, undefined);
});

test('disable restores the originals and removes them from adopted.json', () => {
    const fx = fixture();
    adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped, now: 1000 });
    assert.ok(rj(adopt.adoptedPath(fx.home)).servers.mine);
    const rep = harness.disable({ home: fx.home, files: fx.files, now: 2000 });
    assert.ok(!rep.some((r) => r.error), JSON.stringify(rep));
    assert.ok(rj(fx.f.claude).mcpServers.mine);
    assert.equal(rj(adopt.adoptedPath(fx.home)).servers.mine, undefined);
});

test('AD-1: a name with one unrewritable source is not adopted at all (no half state)', () => {
    const fx = fixture({ claude: { dup: { command: 'node', args: ['d.js'] } }, cursor: { dup: { command: 'node', args: ['d.js'] }, aos: { command: 'keep' } } });
    const before = fs.readFileSync(fx.f.claude, 'utf8');
    const rep = adopt.applyAdopt({ home: fx.home, token: TOKEN, files: fx.files, shipped });
    assert.ok(!rep.adopted.includes('dup'));
    assert.ok(rep.skipped.some((k) => k.name === 'dup' && /cannot be rewritten/.test(k.reason)));
    assert.ok(rj(fx.f.claude).mcpServers.dup, 'the claude entry is untouched');
    const a = fs.existsSync(adopt.adoptedPath(fx.home)) ? rj(adopt.adoptedPath(fx.home)).servers : {};
    assert.equal(a.dup, undefined);
    assert.ok(before.includes('"dup"'));
});

test('AD-4: positional arguments that look like tokens are skipped', () => {
    const fx = fixture({ claude: {
        ghtok: { command: 'node', args: ['s.js', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'] },
        longtok: { command: 'node', args: ['s.js', 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5'] },
        pathy: { command: 'node', args: ['/usr/local/lib/node_modules/some-server/build/index.js', '--port', '8080'] },
    } });
    const s = adopt.scanAdoptable({ files: fx.files, shipped });
    assert.ok(s.skipped.some((k) => k.name === 'ghtok' && /inline-secret/.test(k.reason)));
    assert.ok(s.skipped.some((k) => k.name === 'longtok' && /inline-secret/.test(k.reason)));
    assert.ok(s.adoptable.some((a) => a.name === 'pathy'), 'a plain path argument is still adoptable');
});
