import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { repoIdOf, fingerprint, planKey, groupInstances, ownerOf, jaccard, classifyInstances } from '../skills/global_config/agenttrail/lib/identity.mjs';
import { parsePlan } from '../skills/global_config/agenttrail/lib/plan.mjs';

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

const PLAN_REL = 'production_artifacts/00_execution_plan.md';
const PLAN = `# Two components

## Cart {#cart}
files: [src/cart.ts]

- [ ] Build it {#cart-build}

## Checkout {#checkout}
files: [src/checkout.ts]

- [ ] Build it {#checkout-build}
`;

let repoA;
let repoB;
let wtA;
let wtB;
let plain;

const initRepo = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'production_artifacts'), { recursive: true });
  fs.writeFileSync(path.join(dir, PLAN_REL), PLAN);
  fs.writeFileSync(path.join(dir, 'README.md'), 'x');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'plan');
  return dir;
};

before(() => {
  repoA = initRepo('trail-id-a-');
  repoB = initRepo('trail-id-b-');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-id-wt-'));
  wtA = path.join(base, 'wt-a');
  wtB = path.join(base, 'wt-b');
  git(repoA, 'worktree', 'add', '-q', '-b', 'feat-a', wtA);
  git(repoA, 'worktree', 'add', '-q', '-b', 'feat-b', wtB);
  plain = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-id-plain-'));
  fs.mkdirSync(path.join(plain, 'production_artifacts'), { recursive: true });
  fs.writeFileSync(path.join(plain, PLAN_REL), PLAN);
});

const inst = (p, branch, isMain = false) => {
  const parsed = parsePlan(fs.readFileSync(path.join(p, PLAN_REL), 'utf8'));
  return {
    path: p,
    branch,
    isMain,
    repoId: repoIdOf(p),
    planRel: PLAN_REL,
    plan: parsed,
    fingerprint: fingerprint(parsed),
  };
};

describe('repoIdOf', () => {
  test('every worktree of one repo resolves to the main checkout', () => {
    const main = repoIdOf(repoA);
    assert.equal(main, fs.realpathSync(repoA));
    assert.equal(repoIdOf(wtA), main);
    assert.equal(repoIdOf(wtB), main);
  });

  test('two repos never share an id', () => {
    assert.notEqual(repoIdOf(repoA), repoIdOf(repoB));
  });

  test('a folder that is not a git repo keeps its own path', () => {
    assert.equal(repoIdOf(plain), fs.realpathSync(plain));
  });
});

describe('fingerprint and planKey', () => {
  test('the fingerprint only depends on the component ids, sorted', () => {
    const a = parsePlan('## A {#a}\n\n- [ ] x {#t1}\n\n## B {#b}\n\n- [ ] y {#t2}\n');
    const b = parsePlan('## B {#b}\n\n- [ ] y {#t2}\n\n## A {#a}\n\n- [ ] x {#t1}\n');
    assert.equal(fingerprint(a), fingerprint(b));
  });

  test('different components give a different fingerprint', () => {
    const a = parsePlan('## A {#a}\n\n- [ ] x {#t1}\n');
    const b = parsePlan('## Z {#z}\n\n- [ ] x {#t1}\n');
    assert.notEqual(fingerprint(a), fingerprint(b));
  });

  test('the plan key binds repo, plan path and fingerprint', () => {
    const k = planKey('repo', 'a.md', 'fp');
    assert.equal(k, planKey('repo', 'a.md', 'fp'));
    assert.notEqual(k, planKey('repo2', 'a.md', 'fp'));
    assert.notEqual(k, planKey('repo', 'b.md', 'fp'));
    assert.notEqual(k, planKey('repo', 'a.md', 'fp2'));
  });

  test('two worktrees with the same committed plan land on one key', () => {
    assert.equal(planKey(inst(repoA, 'main', true).repoId, PLAN_REL, inst(repoA, 'main', true).fingerprint),
      planKey(inst(wtA, 'feat-a').repoId, PLAN_REL, inst(wtA, 'feat-a').fingerprint));
  });
});

describe('jaccard', () => {
  test('identical sets are 1, disjoint sets are 0', () => {
    assert.equal(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
    assert.equal(jaccard(new Set(['a']), new Set(['b'])), 0);
  });
  test('half overlap is 1/3', () => {
    assert.ok(Math.abs(jaccard(new Set(['a', 'b']), new Set(['b', 'c'])) - 1 / 3) < 1e-9);
  });
});

describe('groupInstances', () => {
  test('two worktrees with an identical committed plan are one group with one owner and one mirror', () => {
    const list = [inst(repoA, 'main', true), inst(wtA, 'feat-a')];
    const groups = groupInstances(list);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].planKey, list[0].planKey);
    assert.equal(groups[0].owner.path, fs.realpathSync(repoA));
    assert.equal(groups[0].mirrors.length, 1);
    assert.equal(groups[0].mirrors[0].branch, 'feat-a');
    assert.equal(groups[0].divergent.length, 0);
  });

  test('three worktrees of one repo still group into one plan', () => {
    assert.equal(groupInstances([inst(repoA, 'main', true), inst(wtA, 'feat-a'), inst(wtB, 'feat-b')]).length, 1);
  });

  test('two different repos never merge even with an identical plan', () => {
    const groups = groupInstances([inst(repoA, 'main', true), inst(repoB, 'main', true)]);
    assert.equal(groups.length, 2);
    assert.notEqual(groups[0].planKey, groups[1].planKey);
  });

  test('a renamed plan file with the same components keeps the plan key', () => {
    const renamed = 'production_artifacts/01_renamed_plan.md';
    const original = inst(repoA, 'main', true);
    const originalKey = planKey(original.repoId, PLAN_REL, original.fingerprint);
    const moved = inst(wtA, 'feat-a');
    moved.planRel = renamed;
    moved.planKey = planKey(moved.repoId, renamed, moved.fingerprint);
    assert.notEqual(moved.planKey, originalKey, 'the raw key does change when the path changes');
    const groups = groupInstances([original, moved]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].planKey, originalKey, 'rename must keep the original key');
  });

  test('a genuinely different plan stays its own group', () => {
    const other = inst(repoB, 'main', true);
    other.plan = parsePlan('## Different {#different}\n\n- [ ] x {#t}\n');
    other.fingerprint = fingerprint(other.plan);
    other.planKey = planKey(other.repoId, PLAN_REL, other.fingerprint);
    assert.equal(groupInstances([inst(repoA, 'main', true), other]).length, 2);
  });

  test('a non-git folder groups by its own id', () => {
    const list = [inst(plain, 'main', true)];
    assert.equal(groupInstances(list).length, 1);
  });
});

describe('ownerOf', () => {
  const list = [inst(repoA, 'main', true), inst(wtA, 'feat-a')];
  const groups = groupInstances(list);

  test('with no activity at all the main checkout owns the plan', () => {
    assert.equal(ownerOf(groups[0], {}).path, fs.realpathSync(repoA));
  });

  test('the instance with the newest plan-relevant activity owns it', () => {
    const owner = ownerOf(groups[0], {
      [fs.realpathSync(repoA)]: { at: 1000, own: false },
      [fs.realpathSync(wtA)]: { at: 2000, own: true },
    });
    assert.equal(owner.path, fs.realpathSync(wtA));
  });

  test('a tie goes to the main checkout', () => {
    const owner = ownerOf(groups[0], {
      [fs.realpathSync(repoA)]: { at: 5000, own: true },
      [fs.realpathSync(wtA)]: { at: 5000, own: true },
    });
    assert.equal(owner.path, fs.realpathSync(repoA));
  });

  test('the owner is not counted as its own mirror', () => {
    assert.equal(groups[0].mirrors.every((m) => m.path !== groups[0].owner.path), true);
  });
});

describe('classifyInstances', () => {
  test('a worktree with its own changed task status is divergent, not a mirror', () => {
    const list = [inst(repoA, 'main', true), inst(wtA, 'feat-a')];
    const groups = groupInstances(list);
    // Equal timestamps: the main checkout keeps ownership by the tie rule, so the
    // worktree is a non-owner with its own differing work — that is what diverges.
    const activity = {
      [fs.realpathSync(repoA)]: { at: 5000, own: true },
      [fs.realpathSync(wtA)]: { at: 5000, own: true, differs: true },
    };
    const owner = ownerOf(groups[0], activity);
    assert.equal(owner.path, fs.realpathSync(repoA));
    const { mirrors, divergent } = classifyInstances(groups[0].instances, owner, activity);
    assert.equal(mirrors.length, 0);
    assert.equal(divergent.length, 1);
    assert.equal(divergent[0].branch, 'feat-a');
  });

  test('a worktree with its own activity but no difference is a mirror', () => {
    const list = [inst(repoA, 'main', true), inst(wtA, 'feat-a')];
    const groups = groupInstances(list);
    const activity = {
      [fs.realpathSync(repoA)]: { at: 1000, own: false },
      [fs.realpathSync(wtA)]: { at: 2000, own: true, differs: false },
    };
    const owner = ownerOf(groups[0], activity);
    const { mirrors, divergent } = classifyInstances(groups[0].instances, owner, activity);
    assert.equal(mirrors.length, 1);
    assert.equal(divergent.length, 0);
  });
});