import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(new URL('..', import.meta.url))), '..');
const helper = join(repo, 'skills', 'global_config', 'openwiki-skill', 'scripts', 'openwiki_helper.py');

const tmp = mkdtempSync(join(tmpdir(), 'openwiki-helper-'));

function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  if (res.error) throw res.error;
  return res;
}

function runHelper(command, cwd) {
  const res = spawnSync('python3', [helper, '--command', command, '--cwd', cwd], {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
  if (res.error) throw res.error;
  return res;
}

function makeRepo(name, identity) {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  git(['init'], dir);
  if (identity) {
    git(['config', 'user.name', identity.name], dir);
    git(['config', 'user.email', identity.email], dir);
  }
  mkdirSync(join(dir, '.openwiki'), { recursive: true });
  writeFileSync(join(dir, '.openwiki', 'quickstart.md'), '# hello\n');
  return dir;
}

describe('openwiki_helper commit identity fallback', { concurrency: false }, () => {
  test('commit fails without identity when fallback is disabled (baseline)', () => {
    const dir = makeRepo('no-identity-baseline');
    git(['add', '.openwiki/quickstart.md'], dir);
    const res = git(['commit', '-m', 'baseline'], dir);
    assert.notEqual(res.status, 0, 'git commit without identity should fail');
    assert.match(res.stderr, /user\.email|user\.name|identity/i, 'error mentions missing identity');
  });

  test('helper commit succeeds in repo without git identity and uses fallback author', () => {
    const dir = makeRepo('no-identity-helper');
    const res = runHelper('commit', dir);
    assert.equal(res.status, 0, `helper commit should succeed: ${res.stderr}`);
    assert.match(res.stdout, /Successfully committed/);

    const log = git(['log', '-1', '--pretty=format:%an <%ae>'], dir).stdout.trim();
    assert.equal(log, 'AOS OpenWiki <openwiki@aos.local>', 'fallback author is used');
  });

  test('helper commit keeps existing author when git identity is set', () => {
    const dir = makeRepo('with-identity', { name: 'Existing User', email: 'existing@example.com' });
    const res = runHelper('commit', dir);
    assert.equal(res.status, 0, `helper commit should succeed: ${res.stderr}`);

    const log = git(['log', '-1', '--pretty=format:%an <%ae>'], dir).stdout.trim();
    assert.equal(log, 'Existing User <existing@example.com>', 'existing author is preserved');
  });

  test('helper does not write git config when applying fallback', () => {
    const dir = makeRepo('no-identity-config-check');
    runHelper('commit', dir);
    const localName = git(['config', '--local', 'user.name'], dir).stdout.trim();
    const localEmail = git(['config', '--local', 'user.email'], dir).stdout.trim();
    assert.notMatch(localName, /AOS OpenWiki/, 'fallback must not persist user.name');
    assert.notMatch(localEmail, /openwiki@aos\.local/, 'fallback must not persist user.email');
  });
});

after(() => {
  // Tests must not delete temp dirs: the parent tmp dir is left for the OS.
});
