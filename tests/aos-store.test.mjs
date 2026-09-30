import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const cli = join(root, 'bin', 'aos-store.mjs');

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test('store index is compact and pinned', () => {
  const index = JSON.parse(readFileSync(join(root, 'lib', 'ecc-store-index.json'), 'utf8'));
  assert.match(index.pinned_commit, /^[a-f0-9]{40}$/);
  assert.ok(statSync(join(root, 'lib', 'ecc-store-index.json')).size < 300 * 1024);
  assert.ok(Object.keys(index.skills).length > 0);
  assert.ok(Object.keys(index.subagents).length > 0);
});

test('store CLI lists and searches skills', () => {
  assert.match(run(['list', '--type=skills']), /skill\t/);
  assert.match(run(['search', 'django']), /django/);
});

test('store CLI dry-run does not write files', () => {
  const output = run(['install', 'django-patterns', '--project', '--dry-run']);
  assert.match(output, /\[dry-run\] write/);
});

test('store CLI install requires --net flag to download', () => {
  const result = spawnSync(process.execPath, [cli, 'install', 'django-patterns', '--project'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr || result.stdout, /requires internet access.*Pass --net/i);
});

const sha = (b) => createHash('sha256').update(b).digest('hex');
const COMMIT = 'a'.repeat(40);
const FIXTURE = {
  'SKILL.md': { data: '---\nname: fixture-multi\n---\nhi\n' },
  'scripts/run.sh': { data: '#!/bin/sh\necho hi\n', exec: true },
  'references/a.md': { data: 'ref\n' },
};

async function withFixture(mutate, fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'aos-store-multi-'));
  const srv = createServer((req, res) => {
    const rel = req.url.replace(`/${COMMIT}/skills/fixture-multi/`, '');
    const f = FIXTURE[rel];
    res.statusCode = f ? 200 : 404;
    res.end(f ? f.data : 'nope');
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    const files = Object.entries(FIXTURE).map(([path, f]) => ({ path, sha256: sha(f.data), size: Buffer.byteLength(f.data), exec: !!f.exec }));
    const item = { description: 'x', category: 'library', tier: 'free', origin: 'ecc', requires_auth: false, sha256: files[0].sha256, upstream_path: 'skills/fixture-multi/SKILL.md', files };
    mutate?.(item);
    const indexPath = join(tmp, 'index.json');
    writeFileSync(indexPath, JSON.stringify({ version: '1.0.0', pinned_commit: COMMIT, skills: { 'fixture-multi': item }, subagents: { x: item } }));
    const cwd = join(tmp, 'proj');
    mkdirSync(cwd);
    const env = { ...process.env, HOME: join(tmp, 'home'), AOS_STORE_INDEX: indexPath, AOS_STORE_RAW_BASE: `http://127.0.0.1:${srv.address().port}` };
    const cli2 = (args) => new Promise((ok) => execFile(process.execPath, [cli, ...args], { cwd, env }, (error, stdout, stderr) => ok({ code: error ? error.code : 0, stdout, stderr })));
    await fn({ cli: cli2, cwd, item });
  } finally {
    srv.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

const tree = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }) : []);

test('multi-file install writes every file and sets the exec bit', async () => {
  await withFixture(null, async ({ cli, cwd }) => {
    const r = await cli(['install', 'fixture-multi', '--project', '--net']);
    assert.equal(r.code, 0, r.stderr);
    const dir = join(cwd, 'skills', 'fixture-multi');
    for (const [p, f] of Object.entries(FIXTURE)) assert.equal(readFileSync(join(dir, p), 'utf8'), f.data);
    assert.equal(statSync(join(dir, 'scripts', 'run.sh')).mode & 0o777, 0o755);
    assert.notEqual(statSync(join(dir, 'references', 'a.md')).mode & 0o111, 0o111);
  });
});

test('multi-file dry-run lists every file and writes nothing', async () => {
  await withFixture(null, async ({ cli, cwd }) => {
    const r = await cli(['install', 'fixture-multi', '--project', '--dry-run']);
    assert.equal(r.code, 0, r.stderr);
    for (const p of Object.keys(FIXTURE)) assert.ok(r.stdout.includes(join(cwd, 'skills', 'fixture-multi', p)), p);
    assert.deepEqual(tree(join(cwd, 'skills')), []);
  });
});

const rejected = {
  'hash mismatch on one file': (item) => { item.files[2].sha256 = '0'.repeat(64); },
  'size mismatch': (item) => { item.files[1].size += 1; },
  "path with '..'": (item) => { item.files[1].path = '../evil.sh'; },
  'absolute path': (item) => { item.files[1].path = '/tmp/evil.sh'; },
  'backslash path': (item) => { item.files[1].path = 'a\\b.sh'; },
  'file count over the cap': (item) => { for (let i = 0; i < 200; i += 1) item.files.push({ path: `extra/${i}.md`, sha256: '0'.repeat(64), size: 1, exec: false }); },
};
for (const [label, mutate] of Object.entries(rejected)) {
  test(`multi-file install rejects ${label} and writes nothing`, async () => {
    await withFixture(mutate, async ({ cli, cwd }) => {
      const r = await cli(['install', 'fixture-multi', '--project', '--net']);
      assert.notEqual(r.code, 0);
      assert.deepEqual(tree(cwd), []);
      assert.equal(existsSync(join(cwd, '..', 'evil.sh')), false);
      assert.equal(existsSync('/tmp/evil.sh'), false);
    });
  });
}
