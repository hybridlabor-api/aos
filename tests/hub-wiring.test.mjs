import { fileURLToPath } from 'node:url';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(repo, p), 'utf8');
const pkg = JSON.parse(read('package.json'));

describe('WP5 hub wiring', () => {
    test('installer.js routes hub, services and package', () => {
        const src = read('installer.js');
        assert.match(src, /process\.argv\[2\] === 'hub'/);
        assert.match(src, /process\.argv\[2\] === 'services'/);
        assert.match(src, /process\.argv\[2\] === 'package'/);
        assert.match(src, /spawnSync\(process\.execPath, \[hubScript, \.\.\.hubArgs\]/);
        assert.match(src, /shell: false/);
        assert.match(src, /import\('\.\/lib\/hub\/services\.mjs'\)/);
        assert.match(src, /packageCommand\(module\.exports/);
    });

    test('installer help text mentions the three commands', () => {
        const src = read('lib/cli-specs/core.mjs');
        assert.match(src, /name: 'hub'.*Open or control the AOS Hub/);
        assert.match(src, /name: 'services'.*Status or control of the local services/);
        assert.match(src, /name: 'package'.*Install, update, repair or verify one v5 package/);
        assert.match(read('installer.js'), /aosSpec\.commands\.map/);
    });

    test('installer still names aos-dashboard on port 7900 (dashboard alias)', () => {
        const src = read('installer.js');
        assert.match(src, /aos-dashboard/);
        assert.match(src, /127\.0\.0\.1:7900/);
        assert.match(src, /BDB Agent OS Dashboard/);
    });

    test('package.json bin entries and test registration', () => {
        assert.equal(pkg.bin['aos-hub'], 'bin/aos-hub.mjs');
        assert.equal(pkg.bin['aos-dashboard'], 'bin/aos-dashboard.mjs');
        for (const f of ['hub-guard.test.mjs', 'hub-server.test.mjs', 'hub-services.test.mjs', 'hub-catalog.test.mjs', 'hub-store.test.mjs', 'hub-wiring.test.mjs']) {
            assert.match(pkg.scripts.test, new RegExp(`node --test (--\\S+ )*tests/${f.replace(/\./g, '\\.')}`), `test script must include ${f}`);
        }
    });

    test('bin/aos-dashboard.mjs is a thin alias without an HTTP server', () => {
        const src = read('bin/aos-dashboard.mjs');
        assert.ok(!src.includes('createServer'), 'alias must not contain createServer');
        assert.ok(!src.includes('http.createServer'), 'alias must not contain http.createServer');
        assert.match(src, /aos-hub\.mjs/);
        assert.match(src, /--tab/);
        assert.match(src, /services/);
        assert.ok(!/listen\(PORT/.test(src));
    });

    test('commands/hub.md and commands/store.md exist with frontmatter', () => {
        for (const f of ['commands/hub.md', 'commands/store.md']) {
            const src = read(f);
            assert.ok(src.startsWith('---\n'), `${f} needs frontmatter`);
            assert.match(src, /^description: "/m);
        }
    });

    test('docs/hub.md exists and stays short', () => {
        const src = read('docs/hub.md');
        assert.ok(existsSync(path.join(repo, 'docs', 'hub.md')));
        assert.ok(src.split('\n').length < 80);
        for (const needle of ['loopback', 'confirm', 'token', 'on-demand', 'agenttrail', 'aos services']) {
            assert.ok(src.toLowerCase().includes(needle), `docs/hub.md must mention ${needle}`);
        }
    });

    test('doctor keeps its style and never fails the run on hub checks', () => {
        const src = read('bin/aos-doctor.mjs');
        assert.match(src, /async function checkHub\(\)/);
        assert.match(src, /await checkHub\(\);/);
        // every hub row is warning-only: the last argument is true
        const block = src.slice(src.indexOf('async function checkHub'), src.indexOf('async function checkDaemonsAndModules'));
        assert.ok((block.match(/, true\);/g) || []).length >= 3);
    });

    test('docker harness covers procps, curl, non-root and the negatives', () => {
        const src = read('tests/docker/hub.Dockerfile');
        assert.match(src, /FROM node:20-slim/);
        assert.match(src, /procps/);
        assert.match(src, /curl/);
        assert.match(src, /^USER aos/m);
        assert.match(src, /npm ci --ignore-scripts/);
        assert.match(src, /-H 'Host: x\.test'/);
        assert.match(src, /"403"/);
        assert.match(src, /"200"/);
        assert.match(src, /node --test/);
    });

    test('the six hub test files exist in the repo', () => {
        for (const f of ['hub-guard.test.mjs', 'hub-server.test.mjs', 'hub-services.test.mjs', 'hub-catalog.test.mjs', 'hub-store.test.mjs', 'hub-wiring.test.mjs']) {
            assert.ok(existsSync(path.join(repo, 'tests', f)), `tests/${f} must exist`);
        }
        assert.ok(existsSync(path.join(repo, 'bin', 'aos-hub.mjs')));
        assert.ok(existsSync(path.join(repo, 'docs', 'hub.md')));
    });
});

// Regression: a bare `import(join(ROOT, ...))` path fails on Windows (a
// dynamic import needs a file:// URL); every hub dynamic import must be
// wrapped in pathToFileURL.
// Regression (S3-2): the stale-code stamp must include files in lib/hub subdirectories,
// otherwise a code change there never restarts the hub.
test('bin/aos-hub.mjs code stamp walks lib/hub subdirectories', () => {
    const src = read('bin/aos-hub.mjs');
    const stamp = src.slice(src.indexOf('const codeStamp'), src.indexOf('const packageVersion'));
    assert.match(stamp, /isDirectory\(\)/);
    assert.match(stamp, /visit\(join\(ROOT, 'lib', 'hub'\)\)/);
});

// Regression (S3-4): a clean exit (code 0) is a deliberate stop and must not be respawned.
test('bin/aos-hub.mjs watchdog does not respawn a clean exit', () => {
    const src = read('bin/aos-hub.mjs');
    assert.match(src, /child\.on\('exit', \(code\) => \{ if \(code !== 0\)/);
});

// Regression (S3-5): `restart` is a real verb, not a fall-through to start.
test('bin/aos-hub.mjs accepts the restart verb', async () => {
    const { parseArgv } = await import('../bin/aos-hub.mjs');
    assert.equal(parseArgv(['restart']).cmd, 'restart');
    assert.equal(parseArgv(['restart', '--port', '7901']).port, 7901);
});

// Regression (S3-9): an npm bin symlink must still count as the main script.
test('bin/aos-hub.mjs resolves symlinks on argv[1] for the main check', () => {
    const src = read('bin/aos-hub.mjs');
    assert.match(src, /realpathSync\(process\.argv\[1\]/);
    assert.ok(!/resolve\(process\.argv\[1\]\) === SELF/.test(src), 'plain resolve() misses symlinked bins');
});

test('bin/aos-hub.mjs wraps every dynamic import in pathToFileURL', () => {
    const src = read('bin/aos-hub.mjs');
    assert.match(src, /pathToFileURL/);
    assert.ok(!/import\(join\(ROOT/.test(src), 'bare join paths must never be handed to dynamic import');
});

