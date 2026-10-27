import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { changedBetween, gitSnapshot, globToRegExp, matchesAny, relInside, verifyReport } from '../lib/fabric/verify.mjs';
import { tmpProject } from './fixtures/fabric-helpers.mjs';

test('relInside accepts only relative paths that stay inside', () => {
  assert.equal(relInside('a/b.txt'), 'a/b.txt');
  assert.equal(relInside('./a'), 'a');
  assert.equal(relInside('a/../b'), 'b');
  assert.equal(relInside('a\\b'), 'a/b');
  for (const bad of ['', '.', '..', '../x', 'a/../../x', '/abs', 'C:\\x', 'C:/x', '\\\\server\\share', 'a\0b', null, undefined, 5]) {
    assert.equal(relInside(bad), null, JSON.stringify(bad));
  }
});

test('globs: ** crosses folders, * and ? stay inside one, dots are literal', () => {
  const table = [
    ['**', 'a/b/c.js', true], ['**', 'x', true],
    ['production_artifacts/**', 'production_artifacts/plan/plan.mdx', true], ['production_artifacts/**', 'src/a.js', false],
    ['production_artifacts/**', 'production_artifacts', false], ['production_artifacts/**', 'production_artifacts2/x', false],
    ['src/*.js', 'src/a.js', true], ['src/*.js', 'src/x/a.js', false], ['src/*.js', 'src/a.jsx', false],
    ['src/**/*.js', 'src/a.js', true], ['src/**/*.js', 'src/x/y/a.js', true], ['src/**/*.js', 'lib/a.js', false],
    ['a?c', 'abc', true], ['a?c', 'a/c', false], ['a.b', 'a.b', true], ['a.b', 'axb', false],
    ['.github/**', '.github/workflows/ci.yml', true], ['(x)+[y]', '(x)+[y]', true],
  ];
  for (const [glob, file, want] of table) assert.equal(globToRegExp(glob).test(file), want, `${glob} vs ${file}`);
  assert.equal(matchesAny('src/a.js', ['docs/**', 'src/*.js']), true);
  assert.equal(matchesAny('src/a.js', []), false);
  assert.equal(matchesAny('../x', ['production_artifacts/**']), false);
});

test('changedBetween lists added, changed and removed paths', () => {
  assert.deepEqual(changedBetween({ a: '1', b: '2', c: '3' }, { a: '1', b: 'X', d: '4' }), ['b', 'c', 'd']);
  assert.deepEqual(changedBetween({}, {}), []);
});

test('gitSnapshot sees untracked, modified and deleted files, not ignored ones', () => {
  const p = tmpProject();
  try {
    assert.deepEqual(gitSnapshot(p.dir), { ok: true, files: {} });
    fs.writeFileSync(path.join(p.dir, '.gitignore'), 'out/\n');
    fs.mkdirSync(path.join(p.dir, 'out'));
    fs.writeFileSync(path.join(p.dir, 'out', 'ignored.txt'), 'x');
    fs.mkdirSync(path.join(p.dir, 'src', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(p.dir, 'src', 'deep', 'new.js'), 'one');
    fs.writeFileSync(path.join(p.dir, 'README.md'), 'changed\n');
    const a = gitSnapshot(p.dir);
    assert.deepEqual(Object.keys(a.files).sort(), ['.gitignore', 'README.md', 'src/deep/new.js']);
    fs.writeFileSync(path.join(p.dir, 'src', 'deep', 'new.js'), 'two');
    fs.rmSync(path.join(p.dir, 'README.md'));
    const b = gitSnapshot(p.dir);
    assert.deepEqual(changedBetween(a.files, b.files), ['README.md', 'src/deep/new.js']);
    assert.equal(b.files['README.md'], 'deleted');
  } finally { p.cleanup(); }
});

test('gitSnapshot: paths are relative to the work directory, files above it start with ../', () => {
  const p = tmpProject();
  try {
    const sub = path.join(p.dir, 'pkg');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'in.txt'), 'x');
    fs.writeFileSync(path.join(p.dir, 'outside.txt'), 'y');
    const snap = gitSnapshot(sub);
    assert.equal(snap.ok, true);
    assert.deepEqual(Object.keys(snap.files).sort(), ['../outside.txt', 'in.txt']);
  } finally { p.cleanup(); }
});

test('gitSnapshot of a folder that is no git work tree is not ok', () => {
  const p = tmpProject({ git: false });
  try {
    assert.deepEqual(gitSnapshot(p.dir), { ok: false, files: {} });
  } finally { p.cleanup(); }
});

const plan = (over = {}) => ({ step_id: '0-architect-1', node: 'architect', kind: 'plan', allowed_writes: ['production_artifacts/**'], expected_report: '', ...over });
const rep = (over = {}) => ({ status: 'ok', artifacts: {}, findings: [], ...over });
const snap = (files) => ({ ok: true, files });

test('verify: only an ok report is checked', () => {
  const r = verifyReport({ step: plan(), report: rep({ status: 'fail' }), cwd: process.cwd(), before: snap({}), after: snap({ 'src/x': '1' }) });
  assert.deepEqual(r, { problems: [], notes: [] });
});

test('verify: a plan step must name artifacts.plan, and the file must exist', () => {
  const p = tmpProject({ git: false });
  try {
    assert.deepEqual(verifyReport({ step: plan(), report: rep(), cwd: p.dir }).problems.map((x) => x.id), ['artifact-missing']);
    assert.deepEqual(verifyReport({ step: plan(), report: rep({ artifacts: { plan: 'nope.md' } }), cwd: p.dir }).problems.map((x) => x.id), ['artifact-missing']);
    fs.writeFileSync(path.join(p.dir, 'plan.md'), 'x');
    assert.deepEqual(verifyReport({ step: plan(), report: rep({ artifacts: { plan: 'plan.md' } }), cwd: p.dir }).problems, []);
  } finally { p.cleanup(); }
});

test('verify: a build step must name its own artifact key', () => {
  const p = tmpProject({ git: false });
  try {
    const step = plan({ node: 'engineering', kind: 'build', allowed_writes: ['**'] });
    assert.equal(verifyReport({ step, report: rep(), cwd: p.dir, artifactKey: 'backend' }).problems[0].id, 'artifact-missing');
    fs.writeFileSync(path.join(p.dir, 'b.md'), 'x');
    assert.deepEqual(verifyReport({ step, report: rep({ artifacts: { backend: 'b.md' } }), cwd: p.dir, artifactKey: 'backend' }).problems, []);
  } finally { p.cleanup(); }
});

test('verify: artifact paths must stay inside the work tree', () => {
  const p = tmpProject({ git: false });
  try {
    fs.writeFileSync(path.join(p.dir, 'ok.md'), 'x');
    fs.writeFileSync(path.join(p.base, 'secret.txt'), 'x');
    for (const bad of ['../secret.txt', path.join(p.base, 'secret.txt'), 'a/../../secret.txt']) {
      const r = verifyReport({ step: plan(), report: rep({ artifacts: { plan: 'ok.md', other: bad } }), cwd: p.dir });
      assert.deepEqual(r.problems.map((x) => x.id), ['artifact-path'], bad);
    }
    let linked = true;
    try { fs.symlinkSync(path.join(p.base, 'secret.txt'), path.join(p.dir, 'link.md')); } catch { linked = false; }
    if (linked) {
      const r = verifyReport({ step: plan(), report: rep({ artifacts: { plan: 'link.md' } }), cwd: p.dir });
      assert.deepEqual(r.problems.map((x) => x.id), ['artifact-path'], 'a link that leaves the work tree');
    }
  } finally { p.cleanup(); }
});

test('verify: artifact paths with shell metacharacters or spaces are refused, they would end up in commands in later briefs', () => {
  const p = tmpProject({ git: false });
  try {
    const names = ['plan one.md', 'plan;rm.md', 'plan$(x).md', 'plan`x`.md', 'plan"q".md', "plan'q'.md", 'plan&x.md', 'plan|x.md', 'plan>x.md'];
    for (const name of names) {
      fs.writeFileSync(path.join(p.dir, name), 'x');
      const r = verifyReport({ step: plan(), report: rep({ artifacts: { plan: name } }), cwd: p.dir });
      assert.deepEqual(r.problems.map((x) => x.id), ['artifact-path'], name);
      assert.match(r.problems[0].summary, /may use only letters, digits and/);
    }
    fs.mkdirSync(path.join(p.dir, 'production_artifacts', 'plan'), { recursive: true });
    fs.writeFileSync(path.join(p.dir, 'production_artifacts', 'plan', 'plan-v2_final@1+x.mdx'), 'x');
    assert.deepEqual(verifyReport({ step: plan(), report: rep({ artifacts: { plan: 'production_artifacts/plan/plan-v2_final@1+x.mdx' } }), cwd: p.dir }).problems, []);
  } finally { p.cleanup(); }
});

test('verify: Shipping must report every gate key', () => {
  const p = tmpProject({ git: false });
  try {
    const step = plan({ node: 'shipping', kind: 'ship' });
    assert.match(verifyReport({ step, report: rep({ gate: { lint: 'pass' } }), cwd: p.dir }).problems[0].summary, /typecheck, tests, a11y, seo, security/);
    const full = { lint: 'pass', typecheck: 'pass', tests: 'fail', a11y: 'skip', seo: 'skip', security: 'pass' };
    assert.deepEqual(verifyReport({ step, report: rep({ gate: full }), cwd: p.dir }).problems, []);
  } finally { p.cleanup(); }
});

test('verify: a file changed outside allowed_writes is a scope problem, whatever files_changed says', () => {
  const p = tmpProject({ git: false });
  try {
    const before = snap({ 'old.txt': 'h' });
    const after = snap({ 'old.txt': 'h', 'src/evil.txt': 'h2', 'production_artifacts/plan/plan.mdx': 'h3' });
    fs.mkdirSync(path.join(p.dir, 'production_artifacts', 'plan'), { recursive: true });
    fs.writeFileSync(path.join(p.dir, 'production_artifacts', 'plan', 'plan.mdx'), 'x');
    const report = rep({ artifacts: { plan: 'production_artifacts/plan/plan.mdx' }, files_changed: [] });
    const r = verifyReport({ step: plan(), report, cwd: p.dir, before, after });
    assert.deepEqual(r.problems.map((x) => x.id), ['scope']);
    assert.match(r.problems[0].summary, /src\/evil\.txt changed outside allowed_writes/);
    const open = verifyReport({ step: plan({ allowed_writes: ['**'] }), report, cwd: p.dir, before, after });
    assert.deepEqual(open.problems, []);
  } finally { p.cleanup(); }
});

test('verify: the run store, the mirror and the expected report are not scope changes', () => {
  const p = tmpProject({ git: false });
  try {
    const expected = path.join(p.dir, 'production_artifacts', 'runs', 'r', 'reports', '0-architect-1.json');
    fs.mkdirSync(path.join(p.dir, 'x'));
    fs.writeFileSync(path.join(p.dir, 'x', 'a.md'), 'x');
    const after = snap({ 'production_artifacts/runs/r/events.jsonl': '1', 'production_artifacts/state.json': '2', 'production_artifacts/runs/other/state.json': '3' });
    const r = verifyReport({ step: plan({ allowed_writes: [], expected_report: expected, node: 'techlead', kind: 'techlead' }), report: rep(), cwd: p.dir, before: snap({}), after });
    assert.deepEqual(r.problems, []);
    const own = verifyReport({ step: plan({ allowed_writes: [], expected_report: expected, kind: 'techlead' }), report: rep(), cwd: p.dir, before: snap({}), after: snap({ 'x/a.md': '1' }) });
    assert.equal(own.problems.length, 1, 'a write outside the (empty) allowed set still counts');
  } finally { p.cleanup(); }
});

test('verify: a change outside the work directory is a problem even with ** allowed', () => {
  const p = tmpProject({ git: false });
  try {
    fs.writeFileSync(path.join(p.dir, 'p.md'), 'x');
    const r = verifyReport({ step: plan({ allowed_writes: ['**'] }), report: rep({ artifacts: { plan: 'p.md' } }), cwd: p.dir, before: snap({}), after: snap({ '../elsewhere.txt': 'h' }) });
    assert.deepEqual(r.problems.map((x) => x.id), ['scope']);
  } finally { p.cleanup(); }
});

test('verify: without git the scope is not checked, and the report says so (not for the human step)', () => {
  const p = tmpProject({ git: false });
  try {
    fs.writeFileSync(path.join(p.dir, 'p.md'), 'x');
    const r = verifyReport({ step: plan(), report: rep({ artifacts: { plan: 'p.md' } }), cwd: p.dir, before: { ok: false, files: {} }, after: { ok: false, files: {} } });
    assert.equal(r.problems.length, 0);
    assert.match(r.notes[0], /scope not checked/);
    assert.deepEqual(verifyReport({ step: plan({ kind: 'human', node: 'human' }), report: rep(), cwd: p.dir, before: null, after: null }).notes, []);
  } finally { p.cleanup(); }
});
