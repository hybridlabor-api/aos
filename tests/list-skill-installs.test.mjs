import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';

import { main } from '../scripts/list-skill-installs.mjs';

const SCRIPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'list-skill-installs.mjs'
);

function collect(stream) {
  const chunks = [];
  stream.write = (chunk, enc, cb) => {
    chunks.push(String(chunk));
    if (typeof cb === 'function') cb();
    return true;
  };
  return { get text() { return chunks.join(''); } };
}

async function runScript(argv) {
  const outStream = new Writable();
  const errStream = new Writable();
  const out = collect(outStream);
  const err = collect(errStream);
  const exitCode = await main(argv, outStream, errStream);
  return { out: out.text, err: err.text, exitCode };
}

async function writeSkill(root, dir, name, category, extra = '') {
  await mkdir(join(root, 'skills', dir), { recursive: true });
  const fm =
    `---\n` +
    (name === null ? '' : `name: ${name}\n`) +
    (category ? `category: ${category}\n` : '') +
    `description: >-\n  folded text\n  more text\n` +
    `${extra}---\n`;
  await writeFile(join(root, 'skills', dir, 'SKILL.md'), `${fm}\n# skill\n`, 'utf8');
}

async function fixtureRepo() {
  const root = await mkdtemp(join(tmpdir(), 'list-skill-installs-test-'));
  const sub = `${root}-${Math.random().toString(36).slice(2)}`;
  await mkdir(sub, { recursive: true });
  await writeSkill(sub, 'basic/fabric', 'fabric', 'pipeline');
  await writeSkill(sub, 'basic/fabric-graph', 'fabric-graph', 'pipeline');
  await writeSkill(sub, 'global_config/ao-orchestrator', 'ao-orchestrator', 'bdb-core');
  await writeSkill(sub, 'global_config/bdb-memb', 'bdb-memb', 'memb');
  await writeSkill(sub, 'workspace_agents/pb-bug-fix', 'pb-bug-fix', 'playbook');
  await writeSkill(sub, 'global_config/plain-skill', 'plain-skill', 'misc');
  await mkdir(join(sub, 'skills', 'dir with space', 'inner'), { recursive: true });
  await writeFile(
    join(sub, 'skills', 'dir with space', 'inner', 'SKILL.md'),
    '---\nname: has space\ncategory: misc\n---\n# x\n',
    'utf8'
  );
  return { root: sub, scratch: root };
}

test('tiers, ordering, uniqueness, exact commands', async () => {
  const fx = await fixtureRepo();
  try {
    const { out, exitCode } = await runScript(['--root', fx.root, '--repo', 'hybridlabor-api/aos']);
    assert.equal(exitCode, 0);
    const lines = out.split('\n').filter(Boolean);
    assert.deepEqual(lines, [
      'npx skills add hybridlabor-api/aos --skill fabric -y',
      'npx skills add hybridlabor-api/aos --skill fabric-graph -y',
      'npx skills add hybridlabor-api/aos --skill ao-orchestrator -y',
      'npx skills add hybridlabor-api/aos --skill bdb-memb -y',
      'npx skills add hybridlabor-api/aos --skill pb-bug-fix -y',
      'npx skills add hybridlabor-api/aos --skill plain-skill -y',
    ]);
    const names = lines.map((l) => l.split('--skill ')[1]);
    assert.equal(new Set(names).size, names.length, 'each skill exactly once');
    // tier ordering: fabric* (1), ao-orchestrator bdb-core (2), bdb- (3), pb- (4), plain (5)
    assert.ok(lines[0].includes('fabric ') && lines[2].includes('ao-orchestrator'));
    assert.ok(lines[4].startsWith('npx skills add hybridlabor-api/aos --skill pb-'));
  } finally {
  }
});

test('folded description frontmatter is parsed; name only matters', async () => {
  const fx = await fixtureRepo();
  try {
    const { out } = await runScript(['--root', fx.root]);
    assert.ok(out.includes('--skill fabric -y'));
    assert.ok(!out.includes('fabric-multigraph'), 'only fixture skills appear');
    assert.equal(out.split('\n').filter((l) => l.includes('description')).length, 0);
  } finally {
  }
});

test('--json shape', async () => {
  const fx = await fixtureRepo();
  try {
    const { out, exitCode } = await runScript(['--root', fx.root, '--json']);
    assert.equal(exitCode, 0);
    const parsed = JSON.parse(out);
    assert.ok(Array.isArray(parsed));
    for (const e of parsed) {
      assert.deepEqual(Object.keys(e).sort(), ['category', 'command', 'name', 'tier']);
      assert.equal(typeof e.tier, 'number');
      assert.equal(typeof e.command, 'string');
    }
    const tiers = parsed.map((e) => e.tier);
    assert.deepEqual([...tiers].sort((a, b) => a - b), tiers, 'sorted by tier');
  } finally {
  }
});

test('--tier filters', async () => {
  const fx = await fixtureRepo();
  try {
    const { out } = await runScript(['--root', fx.root, '--tier', '2']);
    assert.ok(out.includes('--skill ao-orchestrator -y'));
    assert.ok(!out.includes('--skill fabric -y'));
    assert.ok(!out.includes('--skill bdb-memb -y'));
  } finally {
  }
});

test('--count prints per-tier numbers', async () => {
  const fx = await fixtureRepo();
  try {
    const { out } = await runScript(['--root', fx.root, '--count']);
    assert.match(out, /tier 1: 2/);
    assert.match(out, /tier 2: 1/);
    assert.match(out, /tier 3: 1/);
    assert.match(out, /tier 4: 1/);
    assert.match(out, /tier 5: 1/);
  } finally {
  }
});

test('--out refuses to overwrite an existing file', async () => {
  const fx = await fixtureRepo();
  try {
    const target = join(fx.root, 'existing.txt');
    await writeFile(target, 'KEEP ME', 'utf8');
    const { exitCode, err } = await runScript(['--root', fx.root, '--out', target]);
    assert.equal(exitCode, 2);
    assert.match(err, /refusing to overwrite/i);
    assert.equal(await readFile(target, 'utf8'), 'KEEP ME');
    assert.ok(await access(fx.root).then(() => true).catch(() => false));
  } finally {
  }
});

test('--out writes to a new file', async () => {
  const fx = await fixtureRepo();
  try {
    const target = join(fx.root, 'fresh-commands.txt');
    const { exitCode } = await runScript(['--root', fx.root, '--out', target]);
    assert.equal(exitCode, 0);
    const content = await readFile(target, 'utf8');
    assert.ok(content.includes('npx skills add hybridlabor-api/aos --skill fabric -y'));
  } finally {
  }
});

test('rejected --repo exits with usage error', async () => {
  const fx = await fixtureRepo();
  try {
    for (const bad of ['noslash', 'a/b/c', 'bad name/ok', 'ok/bad name', '-x/y!']) {
      const { exitCode, err } = await runScript(['--root', fx.root, '--repo', bad]);
      assert.equal(exitCode, 2, `repo ${bad} should be rejected`);
      assert.match(err, /--repo/);
    }
  } finally {
  }
});

test('unknown arg is a usage error', async () => {
  const { exitCode, err } = await runScript(['--nope']);
  assert.equal(exitCode, 2);
  assert.match(err, /unknown argument/);
});

test('bad skill name is skipped and reported, never in commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'list-skill-installs-test-'));
  const sub = join(root, 'repo');
  await mkdir(join(sub, 'skills', 'dir with space', 'inner'), { recursive: true });
  await writeFile(
    join(sub, 'skills', 'dir with space', 'inner', 'SKILL.md'),
    '---\nname: has space\ncategory: misc\n---\n# x\n',
    'utf8'
  );
  await writeSkill(sub, 'ok', 'plain-skill', 'misc');
  try {
    const { out, err, exitCode } = await runScript(['--root', sub]);
    assert.equal(exitCode, 0);
    assert.ok(err.includes('skipped invalid skill name'));
    assert.ok(!out.includes('has space'));
    const lines = out.split('\n').filter(Boolean);
    for (const line of lines) {
      assert.match(line, /^npx skills add [A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+ --skill [A-Za-z0-9_-]+ -y$/);
    }
  } finally {
  }
});

test('script source never imports child_process or spawns/execs', async () => {
  const source = await readFile(SCRIPT_PATH, 'utf8');
  assert.ok(!source.includes('child_process'));
  for (const forbidden of ['spawn', 'exec', 'execFile', 'fork(', 'execSync', 'spawnSync']) {
    assert.ok(!source.includes(forbidden), `forbidden token: ${forbidden}`);
  }
});

test('default root is the repo root and contains expected skills', async () => {
  const { out } = await runScript(['--count']);
  assert.match(out, /tier 1: \d+/);
});
