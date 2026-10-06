// Quick Update regressions: AO downgrade guard, user-edited agents, AO version
// line, English banner. Offline; HOME is a temp dir; nothing executes ao.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-qu-home-'));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
delete process.env.AO_RUN_FILE;
delete process.env.AOS_AO_DEV_BUILD;
test.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

const {
    readGoBuildInfo, parseGoBuildInfo, decideAoInstall, checkAoWorkspace, installAoBinary,
    describeAoVersion, buildAoAnnouncementBanner, readAoDaemonIdentity, selectAoCandidate, agentsNotShippedAsFiles, parseAgentsMd,
    resolveFileConflict, buildKnownSourceHashes, computeFileHash,
} = require('../installer.js');

function tmpDir() {
    const d = fs.mkdtempSync(path.join(tmpHome, 'case-'));
    return d;
}

const goVersionM = (rev, time, modified) => [
    '/x/ao: go1.24.13',
    '\tpath\tgithub.com/aoagents/agent-orchestrator/backend/cmd/ao',
    '\tmod\tgithub.com/aoagents/agent-orchestrator/backend\t(devel)\t',
    '\tbuild\t-ldflags="-s -w"',
    '\tbuild\tvcs=git',
    `\tbuild\tvcs.revision=${rev}`,
    `\tbuild\tvcs.time=${time}`,
    `\tbuild\tvcs.modified=${modified}`,
].join('\n');

const OLD = parseGoBuildInfo(goVersionM('4a826985e0000000000000000000000000000000', '2026-09-29T10:00:00Z', false));
const NEW = parseGoBuildInfo(goVersionM('3b873af12d26ce06c9b54ed5ecf26cfa29c597e1', '2026-10-01T19:28:57Z', false));
const NEW_DIRTY = { ...NEW, revision: 'ffff00000000000000000000000000000000ffff', time: '2026-10-02T00:00:00Z', modified: true };

test('parseGoBuildInfo reads revision, time and modified from `go version -m` output', () => {
    assert.deepStrictEqual(OLD, { revision: '4a826985e0000000000000000000000000000000', time: '2026-09-29T10:00:00Z', modified: false });
    assert.strictEqual(parseGoBuildInfo(goVersionM('abc', '2026-01-01T00:00:00Z', true)).modified, true);
    assert.strictEqual(parseGoBuildInfo('no build info here'), null);
});

test('readGoBuildInfo reads the embedded buildinfo from binary bytes without executing them', () => {
    const dir = tmpDir();
    const bin = path.join(dir, 'ao');
    const start = Buffer.from('3077af0c9274080241e1c107e6d618e6', 'hex');
    const end = Buffer.from('f932433186182072008242104116d8f2', 'hex');
    const info = goVersionM(NEW.revision, NEW.time, true).split('\n').slice(1).map((l) => l.slice(1)).join('\n');
    fs.writeFileSync(bin, Buffer.concat([Buffer.from('\x7fELF junk'), start, Buffer.from(info + '\n'), end, Buffer.from('tail')]));
    assert.deepStrictEqual(readGoBuildInfo(bin), { revision: NEW.revision, time: NEW.time, modified: true });

    fs.writeFileSync(path.join(dir, 'plain'), 'not a go binary');
    assert.strictEqual(readGoBuildInfo(path.join(dir, 'plain')), null);
    assert.strictEqual(readGoBuildInfo(path.join(dir, 'missing')), null);
});

test('decideAoInstall: older candidate is refused', () => {
    const v = decideAoInstall({ installedExists: true, installed: NEW, candidate: OLD });
    assert.strictEqual(v.install, false);
    assert.match(v.reason, /not newer/);
});

test('decideAoInstall: equal revision is refused', () => {
    const v = decideAoInstall({ installedExists: true, installed: NEW, candidate: { ...NEW } });
    assert.strictEqual(v.install, false);
    assert.match(v.reason, /already at/);
});

test('decideAoInstall: strictly newer clean candidate is installed', () => {
    assert.strictEqual(decideAoInstall({ installedExists: true, installed: OLD, candidate: NEW }).install, true);
});

test('decideAoInstall: dirty candidate never replaces a clean install, even when newer', () => {
    const v = decideAoInstall({ installedExists: true, installed: NEW, candidate: NEW_DIRTY });
    assert.strictEqual(v.install, false);
    assert.match(v.reason, /dirty/);
});

test('decideAoInstall: unreadable installed binary is never replaced blind', () => {
    const v = decideAoInstall({ installedExists: true, installed: null, candidate: NEW });
    assert.strictEqual(v.install, false);
    assert.match(v.reason, /unreadable/);
});

test('decideAoInstall: unreadable candidate is refused; nothing installed means install', () => {
    assert.strictEqual(decideAoInstall({ installedExists: true, installed: NEW, candidate: null }).install, false);
    assert.strictEqual(decideAoInstall({ installedExists: false, installed: null, candidate: null }).install, true);
});

test('checkAoWorkspace accepts only a clean checkout whose HEAD is on a tag', () => {
    const git = (map) => (args) => {
        const out = map[args[0]];
        if (out instanceof Error) throw out;
        return out;
    };
    assert.match(checkAoWorkspace('/ws', git({ status: ' M backend/x.go\n?? openwiki/.run.json' })).reason, /uncommitted/);
    assert.match(checkAoWorkspace('/ws', git({ status: '', describe: new Error('fatal: no tag exactly matches') })).reason, /not on a release tag/);
    assert.deepStrictEqual(
        checkAoWorkspace('/ws', git({ status: '', describe: 'v1.3.0', 'rev-parse': NEW.revision })),
        { ok: true, tag: 'v1.3.0', head: NEW.revision });
    assert.strictEqual(checkAoWorkspace('/ws', () => { throw new Error('not a git repository'); }).ok, false);
});

function aoFixture() {
    const dir = tmpDir();
    const dest = path.join(dir, 'bin', 'ao');
    const src = path.join(dir, 'candidate');
    fs.mkdirSync(path.dirname(dest));
    fs.writeFileSync(dest, 'OLD-BINARY');
    fs.writeFileSync(src, 'NEW-BINARY');
    return { dir, dest, src };
}

test('installAoBinary backs up the previous binary, swaps, and waits for the daemon', async () => {
    const { dest, src } = aoFixture();
    const calls = [];
    const r = await installAoBinary({
        src, dest, stamp: 'T1',
        serviceInstall: async (bin) => { calls.push(['service', fs.readFileSync(bin, 'utf8')]); },
        waitForDaemon: async () => { calls.push(['wait']); return true; },
    });
    assert.deepStrictEqual(r, { ok: true, backup: `${dest}.bak-T1`, listening: true, restarted: true });
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'NEW-BINARY');
    assert.strictEqual(fs.readFileSync(`${dest}.bak-T1`, 'utf8'), 'OLD-BINARY');
    assert.deepStrictEqual(calls, [['service', 'NEW-BINARY'], ['wait']]);
});

test('installAoBinary restores the backup when the service install fails', async () => {
    const { dest, src } = aoFixture();
    let waited = false;
    const seen = [];
    const r = await installAoBinary({
        src, dest, stamp: 'T2',
        serviceInstall: async (bin) => { seen.push(fs.readFileSync(bin, 'utf8')); if (seen.length === 1) throw new Error('exit 1'); },
        waitForDaemon: async () => { waited = true; return true; },
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.restored, true);
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'OLD-BINARY');
    assert.deepStrictEqual(seen, ['NEW-BINARY', 'OLD-BINARY'], 'the old daemon is re-registered after the restore');
    assert.strictEqual(waited, false);
});

test('installAoBinary reports a silent daemon without claiming success and keeps the backup', async () => {
    const { dest, src } = aoFixture();
    const r = await installAoBinary({ src, dest, stamp: 'T3', serviceInstall: async () => {}, waitForDaemon: async () => false });
    assert.deepStrictEqual(r, { ok: true, backup: `${dest}.bak-T3`, listening: false, restarted: true });
    assert.strictEqual(fs.readFileSync(`${dest}.bak-T3`, 'utf8'), 'OLD-BINARY');
});

test('installAoBinary leaves the installed binary alone when the swap fails', async () => {
    const { dir, dest } = aoFixture();
    const r = await installAoBinary({ src: path.join(dir, 'missing'), dest, stamp: 'T4', serviceInstall: async () => { throw new Error('must not run'); }, waitForDaemon: async () => true });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'OLD-BINARY');
});

function conflictFixture() {
    const dir = tmpDir();
    const src = path.join(dir, 'src', 'architect.md');
    const target = path.join(dir, 'home', '.claude', 'agents', 'architect.md');
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.writeFileSync(src, 'shipped v1\n');
    const manifest = {};
    const hashes = buildKnownSourceHashes([path.dirname(src)]);
    assert.strictEqual(resolveFileConflict(src, target, manifest, hashes), 'wrote');
    fs.writeFileSync(src, 'shipped v2\n');
    return { src, target, manifest, hashes: buildKnownSourceHashes([path.dirname(src)]) };
}

test('a user-edited agent file is kept and the shipped version lands in <file>.new', () => {
    const { src, target, manifest, hashes } = conflictFixture();
    const recorded = manifest[target].sha256;
    fs.writeFileSync(target, 'my own architect\n');
    assert.strictEqual(resolveFileConflict(src, target, manifest, hashes), 'kept');
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'my own architect\n');
    assert.strictEqual(fs.readFileSync(`${target}.new`, 'utf8'), 'shipped v2\n');
    assert.strictEqual(manifest[target].sha256, recorded, 'the edit stays detectable on the next run');
    assert.ok(!fs.readdirSync(path.dirname(target)).some((f) => f.endsWith('.bak')));
});

test('an unmodified agent file is updated in place with no .new and no .bak', () => {
    const { src, target, manifest, hashes } = conflictFixture();
    assert.strictEqual(resolveFileConflict(src, target, manifest, hashes), 'wrote');
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'shipped v2\n');
    assert.strictEqual(manifest[target].sha256, computeFileHash(src));
    assert.deepStrictEqual(fs.readdirSync(path.dirname(target)), ['architect.md']);
});

test('the global agent compile skips every persona .claude/agents already ships', () => {
    const root = path.join(__dirname, '..');
    const agents = parseAgentsMd(fs.readFileSync(path.join(root, '.agents', 'AGENTS.md'), 'utf8'));
    assert.ok(agents.length >= 13);
    assert.deepStrictEqual(agentsNotShippedAsFiles(agents, path.join(root, '.claude', 'agents')).map((a) => a.name), []);

    const shipped = tmpDir();
    fs.writeFileSync(path.join(shipped, 'architect.md'), 'x');
    assert.deepStrictEqual(agentsNotShippedAsFiles([{ name: 'Architect' }, { name: 'Godmode_UI_UX' }], shipped).map((a) => a.name), ['Godmode_UI_UX']);
});

test('describeAoVersion compares only the recorded release version of the binary on disk', () => {
    const record = { version: '1.2.0', revision: OLD.revision };
    assert.deepStrictEqual(describeAoVersion({ exists: true, build: OLD, record, latest: '1.3.0' }),
        { text: 'Update available (v1.2.0 ➔ v1.3.0)', updateAvailable: true });
    assert.deepStrictEqual(describeAoVersion({ exists: true, build: OLD, record: { version: '1.3.0', revision: OLD.revision }, latest: '1.3.0' }),
        { text: 'v1.3.0 (Up to date)', updateAvailable: false });

    const dirty = describeAoVersion({ exists: true, build: { ...OLD, modified: true }, record, latest: '1.3.0' });
    assert.strictEqual(dirty.updateAvailable, false);
    assert.match(dirty.text, /^Dev build 4a826985e .*not a release/);

    const foreign = describeAoVersion({ exists: true, build: NEW, record, latest: '1.3.0' });
    assert.strictEqual(foreign.updateAvailable, false, 'a record for another revision says nothing about this binary');
    assert.match(foreign.text, /release version unknown/);

    assert.strictEqual(describeAoVersion({ exists: true, build: null, record, latest: '1.3.0' }).updateAvailable, false);
    assert.strictEqual(describeAoVersion({ exists: false }).text, 'Not installed');
});

test('the AO announcement banner is English and its box is aligned', () => {
    const plain = buildAoAnnouncementBanner().replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
    const german = ['JETZT', 'VERFÜGBAR', 'FINALE', 'nächste', 'Generation der', 'freigeschaltet', 'für alle',
        'Befehl', 'Hintergrunddienst', 'aktivieren', ' oder ', 'Telemetrie', 'Multi-Agenten'];
    for (const word of german) assert.ok(!plain.includes(word), `banner still contains German "${word}"`);
    const widths = new Set(plain.split('\n').map((l) => [...l].length));
    assert.deepStrictEqual([...widths], [80]);
});

test('readAoDaemonIdentity uses pid+startedAt, pid alone, or null when running.json is missing', () => {
    const dir = tmpDir();
    const f = path.join(dir, 'running.json');
    assert.strictEqual(readAoDaemonIdentity(f), null);
    fs.writeFileSync(f, JSON.stringify({ pid: 42, port: 3101, startedAt: '2026-10-01T20:00:00Z' }));
    assert.strictEqual(readAoDaemonIdentity(f), '42@2026-10-01T20:00:00Z');
    fs.writeFileSync(f, JSON.stringify({ pid: 42, port: 3101 }));
    assert.strictEqual(readAoDaemonIdentity(f), '42');
    fs.writeFileSync(f, 'garbage');
    assert.strictEqual(readAoDaemonIdentity(f), null);
});

test('restart wait: a changed daemon identity after the service install is a success', async () => {
    const { dest, src } = aoFixture();
    let id = '100@t0';
    const r = await installAoBinary({
        src, dest, stamp: 'R1', restartWaitMs: 2000,
        readIdentity: () => id,
        serviceInstall: async () => { setTimeout(() => { id = '200@t1'; }, 50); },
        waitForDaemon: async () => true,
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.restarted, true);
    assert.strictEqual(r.listening, true);
});

test('restart wait: an unchanged identity on :3101 is not reported as success', async () => {
    const { dest, src } = aoFixture();
    const r = await installAoBinary({
        src, dest, stamp: 'R2', restartWaitMs: 100,
        readIdentity: () => '100@t0',
        serviceInstall: async () => {},
        waitForDaemon: async () => true,
    });
    assert.strictEqual(r.listening, true);
    assert.strictEqual(r.restarted, false, 'the old process still answers');
    assert.strictEqual(fs.readFileSync(`${dest}.bak-R2`, 'utf8'), 'OLD-BINARY');
});

test('restart wait: without running.json only the port check decides', async () => {
    const { dest, src } = aoFixture();
    let waited = 0;
    const r = await installAoBinary({
        src, dest, stamp: 'R3', restartWaitMs: 5000,
        readIdentity: () => null,
        serviceInstall: async () => {},
        waitForDaemon: async () => { waited++; return true; },
    });
    assert.deepStrictEqual([r.restarted, r.listening, waited], [true, true, 1]);
});

function selectFixture(overrides = {}) {
    const calls = { download: [], build: [] };
    const deps = {
        checkoutDir: '/dev/ao', isLocalGitRepo: true, releaseDir: '/mods/ao', devOptIn: false, dryRun: false,
        checkWorkspace: () => ({ ok: false, reason: 'it has uncommitted or untracked changes' }),
        download: (dir) => { calls.download.push(dir); return true; },
        build: (dir) => { calls.build.push(dir); return `${dir}/built-ao`; },
        candidatesIn: (dir) => [`${dir}/backend/bin/ao-test`],
        ...overrides,
    };
    return { deps, calls };
}

test('release fallback: a dirty or untagged checkout uses the published package, never the checkout', () => {
    const real = fs.existsSync;
    fs.existsSync = (p) => p === '/mods/ao/backend/bin/ao-test' || real(p);
    try {
        for (const reason of ['it has uncommitted or untracked changes', 'HEAD is not on a release tag']) {
            const { deps, calls } = selectFixture({ checkWorkspace: () => ({ ok: false, reason }) });
            assert.deepStrictEqual(selectAoCandidate(deps), { bin: '/mods/ao/backend/bin/ao-test', source: 'release' });
            assert.deepStrictEqual(calls, { download: ['/mods/ao'], build: [] });
        }
    } finally { fs.existsSync = real; }
});

test('release fallback: nothing is downloaded under --dry-run', () => {
    const { deps, calls } = selectFixture({ dryRun: true });
    assert.strictEqual(selectAoCandidate(deps).bin, null);
    assert.deepStrictEqual(calls, { download: [], build: [] });
});

test('release fallback: a failed download keeps the installed binary', () => {
    const { deps } = selectFixture({ download: () => false });
    assert.deepStrictEqual(selectAoCandidate(deps), { bin: null, source: 'download-failed' });
});

test('dev-build opt-in: AOS_AO_DEV_BUILD rebuilds from HEAD, never a stale backend/bin artifact', () => {
    const on = selectFixture({ devOptIn: true });
    assert.deepStrictEqual(selectAoCandidate(on.deps), { bin: '/dev/ao/built-ao', source: 'dev', allowDirty: true });
    assert.deepStrictEqual(on.calls, { download: [], build: ['/dev/ao'] });

    const off = selectFixture({ devOptIn: false, download: () => false });
    assert.strictEqual(selectAoCandidate(off.deps).source, 'download-failed');
    assert.deepStrictEqual(off.calls.build, []);
});

test('dev-build opt-in still refuses a downgrade by vcs.time; dirty is allowed only with the opt-in', () => {
    const olderDirty = { ...OLD, modified: true };
    const newerDirty = NEW_DIRTY;
    assert.strictEqual(decideAoInstall({ installedExists: true, installed: NEW, candidate: olderDirty, allowDirty: true }).install, false);
    assert.strictEqual(decideAoInstall({ installedExists: true, installed: NEW, candidate: newerDirty, allowDirty: true }).install, true);
    assert.strictEqual(decideAoInstall({ installedExists: true, installed: NEW, candidate: newerDirty }).install, false);
});

test('a release candidate older than the installed build is refused', () => {
    assert.strictEqual(decideAoInstall({ installedExists: true, installed: NEW, candidate: OLD, candidateIsRelease: true }).install, false);
});

test('unreadable installed binary: a clean release replaces it only when no daemon is running', () => {
    const base = { installedExists: true, installed: null, candidate: NEW, candidateIsRelease: true };
    assert.strictEqual(decideAoInstall({ ...base, daemonRunning: false }).install, true);
    assert.strictEqual(decideAoInstall({ ...base, daemonRunning: true }).install, false);
    assert.strictEqual(decideAoInstall({ ...base, candidateIsRelease: false, daemonRunning: false }).install, false);
    assert.strictEqual(decideAoInstall({ ...base, candidate: NEW_DIRTY, daemonRunning: false, allowDirty: true }).install, false);
});

test('release fallback never downloads into a git checkout', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, '.git'));
    const { deps, calls } = selectFixture({ releaseDir: dir });
    assert.strictEqual(selectAoCandidate(deps).bin, null);
    assert.deepStrictEqual(calls.download, []);
});
