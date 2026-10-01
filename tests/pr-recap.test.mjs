import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'skills/global_config/pr-recap/scripts/pr-recap.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-recap-'));
const repo = path.join(tmp, 'repo');
const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
const HOSTILE = 'a<b>{c}`d`<Callout>.txt';
const noNet = { ...process.env, HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', PATH: process.env.PATH.split(path.delimiter).filter((p) => !fs.existsSync(path.join(p, 'gh'))).join(path.delimiter) };
const recap = (...a) => spawnSync(process.execPath, [script, ...a], { cwd: repo, encoding: 'utf8', env: noNet });

fs.mkdirSync(repo);
git('init', '-q', '-b', 'main');
git('config', 'user.email', 't@example.com');
git('config', 'user.name', 'T');
fs.mkdirSync(path.join(repo, 'src'));
fs.writeFileSync(path.join(repo, 'src/keep.js'), 'a\n');
fs.writeFileSync(path.join(repo, 'src/gone.js'), 'x\n');
fs.writeFileSync(path.join(repo, 'src/edit.js'), '1\n');
git('add', '.'); git('commit', '-qm', 'base');
fs.writeFileSync(path.join(repo, 'src/edit.js'), '1\n2\n');
fs.writeFileSync(path.join(repo, 'src/new.js'), 'n\n');
fs.writeFileSync(path.join(repo, HOSTILE), 'h\n');
fs.unlinkSync(path.join(repo, 'src/gone.js'));
git('add', '-A'); git('commit', '-qm', 'change <script>alert(1)</script>');

const out = path.join(tmp, 'out');
const ver = path.join(tmp, 'v.json');
fs.writeFileSync(ver, JSON.stringify([{ command: 'npm test', exit: 0, note: 'ok' }, { command: 'lint <b>', exit: 1, note: 'bad {x}' }]));
const r = recap('--range', 'HEAD~1..HEAD', '--out', out, '--verification', ver, '--title', 'T </Callout> {x} `y`');
const mdx = () => fs.readFileSync(path.join(out, 'plan.mdx'), 'utf8');
const html = () => fs.readFileSync(path.join(out, 'plan.builder.html'), 'utf8');

test('runs offline, exits 0, renders with 0 warnings', () => {
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\(0 warnings\)/);
  assert.ok(fs.existsSync(path.join(out, 'plan.builder.html')));
});

test('diff maps to tree markers', () => {
  const m = mdx();
  assert.match(m, /path: "src\/new\.js", depth: 1, change: "added"/);
  assert.match(m, /path: "src\/gone\.js", depth: 1, change: "deleted"/);
  assert.match(m, /path: "src\/edit\.js", depth: 1, change: "modified", note: "\+1 -0"/);
  assert.doesNotMatch(m, /src\/keep\.js/);
});

test('hostile names and titles cannot inject tags or break the page', () => {
  const m = mdx();
  assert.ok(!m.includes('<b>') && !m.includes('<Callout>.txt'), 'raw hostile text must not reach the MDX');
  assert.ok(m.includes('a\\u003cb\\u003e\\u007bc\\u007d'), 'file name is \\u-escaped in the JSX literal');
  const h = html();
  assert.ok(!/<b>|<script>alert|<Callout>\.txt/.test(h.replace(/<script[\s\S]*?<\/script>/g, '')), 'no injected tags');
  assert.ok(h.includes('a&lt;b&gt;'), 'file name shown escaped');
});

test('verification table separates Verified from Not verified', () => {
  const m = mdx();
  assert.match(m, /"npm test", "0", "Verified"/);
  assert.match(m, /"Not verified \(failed\)"/);
  assert.match(m, /label: "Not verified"/);
  assert.match(html(), /Everything not listed in the table above was not run/);
});

test('without --verification nothing is claimed as verified', () => {
  const o2 = path.join(tmp, 'out2');
  assert.equal(recap('--range', 'HEAD~1..HEAD', '--out', o2).status, 0);
  const m = fs.readFileSync(path.join(o2, 'plan.mdx'), 'utf8');
  assert.match(m, /"none recorded", "-", "Not verified"/);
  assert.match(m, /Nothing was recorded as passing/);
});

test('before/after images are copied and referenced relatively', () => {
  const png = path.join(tmp, 'x.png');
  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  const o3 = path.join(tmp, 'out3');
  const x = recap('--range', 'HEAD~1..HEAD', '--out', o3, '--before', png, '--after', png);
  assert.equal(x.status, 0, x.stderr);
  assert.ok(fs.existsSync(path.join(o3, 'before.png')) && fs.existsSync(path.join(o3, 'after.png')));
  assert.match(fs.readFileSync(path.join(o3, 'plan.mdx'), 'utf8'), /!\[Before\]\(before\.png\)/);
});

test('bad arguments exit 2 with a clear message', () => {
  for (const args of [[], ['--range', 'HEAD'], ['--range', '--evil..x'], ['--pr', 'abc'], ['--range', 'a..b', '--pr', '1'], ['--nope'], ['--range', 'HEAD~1..HEAD', '--before', 'x.png'], ['--range', 'HEAD~1..HEAD', '--verification', ver + '.missing']]) {
    const x = recap(...args);
    assert.equal(x.status, 2, args.join(' '));
    assert.match(x.stderr, /error: /);
  }
});

test('script never calls a GitHub write command', () => {
  const src = fs.readFileSync(script, 'utf8');
  assert.ok(!/(execFileSync|spawnSync)\([^)]*'pr',\s*'(comment|edit|create|merge)'/.test(src));
  assert.ok(!/fetch\(|https?:\/\/[a-z]/.test(src.replace(/\/\/.*$/gm, '')));
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
