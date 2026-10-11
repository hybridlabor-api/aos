// agy worker home (mcps/mcsc/packages/core/src/no-mcp.js). Temp dirs stand in for the real home; nothing
// here touches the real home or runs agy. Temp dirs are left for the container to discard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  ensureAgyWorkerHome, agyNoMcpEnv, agyChildEnv, removeAgyWorkerHome, agyWorkerHomeDir,
} = await import(new URL('../mcps/mcsc/packages/core/src/no-mcp.js', import.meta.url).href);

const EMPTY = '{"mcpServers":{}}\n';
const REAL_MCP = '{"mcpServers":{"real":{}}}';
// Symlink semantics are POSIX here; the win32 branch is exercised through an injected fs.
const POSIX = process.platform !== 'win32';

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-home-'));
  const put = (rel, text) => {
    const p = path.join(home, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };
  put('.gitconfig', 'git');
  put('.ssh/config', 'ssh');
  put('.gemini/settings.json', 'settings');
  put('.gemini/config/auth.json', 'auth');
  put('.gemini/config/mcp_config.json', REAL_MCP);
  put('.gemini/config/plugins/a/mcp_config.json', '{"mcpServers":{"own":{}}}');
  put('.gemini/config/plugins/a/hooks.json', 'hooks');
  put('.gemini/config/plugins/b/readme.md', 'b');
  put('.aos/go/token.json', 'tok');
  return home;
}

const isLink = (p) => fs.lstatSync(p).isSymbolicLink();
const gone = (p) => { try { fs.lstatSync(p); return false; } catch { return true; } };
const workOf = (home) => agyWorkerHomeDir(home);

// Symlinks to files fail (no Developer Mode), junctions still work; linkSync optionally fails too.
const winFs = ({ failHardLink = false } = {}) => ({
  ...fs,
  symlinkSync(target, p, type) {
    if (type !== 'junction' && fs.statSync(target).isFile()) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    return fs.symlinkSync(target, p, type);
  },
  linkSync(target, p) {
    if (failHardLink) throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
    return fs.linkSync(target, p);
  },
});

test('mirror: top-level links, rebuilt .gemini/config, generated empty MCP configs', { skip: !POSIX }, () => {
  const home = makeHome();
  const w = ensureAgyWorkerHome({ home });
  assert.equal(w, workOf(home));
  assert.equal(fs.readlinkSync(path.join(w, '.gitconfig')), path.join(home, '.gitconfig'));
  assert.equal(fs.readFileSync(path.join(w, '.ssh', 'config'), 'utf8'), 'ssh');
  assert.ok(fs.lstatSync(path.join(w, '.gemini')).isDirectory());
  assert.ok(isLink(path.join(w, '.gemini', 'settings.json')));
  assert.ok(isLink(path.join(w, '.gemini', 'config', 'auth.json')));
  assert.equal(fs.readFileSync(path.join(w, '.gemini', 'config', 'mcp_config.json'), 'utf8'), EMPTY);
  assert.ok(!isLink(path.join(w, '.gemini', 'config', 'mcp_config.json')));
  assert.equal(fs.readFileSync(path.join(w, '.gemini', 'config', 'plugins', 'a', 'mcp_config.json'), 'utf8'), EMPTY);
  assert.ok(isLink(path.join(w, '.gemini', 'config', 'plugins', 'a', 'hooks.json')));
  assert.ok(isLink(path.join(w, '.gemini', 'config', 'plugins', 'b')));
  assert.ok(isLink(path.join(w, '.aos', 'go')));
  assert.ok(gone(path.join(w, '.aos', 'agy-worker-home')));
  assert.equal(fs.readFileSync(path.join(home, '.gemini', 'config', 'mcp_config.json'), 'utf8'), REAL_MCP);
});

test('idempotent: a second call leaves the same layout', { skip: !POSIX }, () => {
  const home = makeHome();
  const w = ensureAgyWorkerHome({ home });
  const before = fs.readdirSync(w, { recursive: true }).sort();
  assert.equal(ensureAgyWorkerHome({ home }), w);
  assert.deepEqual(fs.readdirSync(w, { recursive: true }).sort(), before);
  assert.equal(fs.readFileSync(path.join(w, '.gemini', 'config', 'mcp_config.json'), 'utf8'), EMPTY);
});

test('dangling link is replaced; link to a vanished real entry is pruned', { skip: !POSIX }, () => {
  const home = makeHome();
  const w = ensureAgyWorkerHome({ home });
  fs.unlinkSync(path.join(w, '.gitconfig'));
  fs.symlinkSync('/nonexistent/aos-test-target', path.join(w, '.gitconfig'));
  ensureAgyWorkerHome({ home });
  assert.equal(fs.readlinkSync(path.join(w, '.gitconfig')), path.join(home, '.gitconfig'));

  fs.unlinkSync(path.join(home, '.gitconfig'));
  ensureAgyWorkerHome({ home });
  assert.ok(gone(path.join(w, '.gitconfig')));
});

test('foreign files and directories in the worker home are left alone', { skip: !POSIX }, () => {
  const home = makeHome();
  const w = workOf(home);
  fs.mkdirSync(w, { recursive: true });
  fs.writeFileSync(path.join(w, 'notes.txt'), 'mine');
  fs.mkdirSync(path.join(w, '.cache'));
  fs.writeFileSync(path.join(w, '.gitconfig'), 'mine too');
  ensureAgyWorkerHome({ home });
  assert.equal(fs.readFileSync(path.join(w, 'notes.txt'), 'utf8'), 'mine');
  assert.ok(fs.lstatSync(path.join(w, '.cache')).isDirectory());
  assert.equal(fs.readFileSync(path.join(w, '.gitconfig'), 'utf8'), 'mine too');
});

test('win32: file symlink fails, hard link used; no hard link either gives null', () => {
  const home = makeHome();
  const w = ensureAgyWorkerHome({ home, platform: 'win32', fs: winFs() });
  assert.equal(w, workOf(home));
  const real = fs.statSync(path.join(home, '.gitconfig'));
  const made = fs.lstatSync(path.join(w, '.gitconfig'));
  assert.ok(!made.isSymbolicLink());
  assert.equal(made.ino, real.ino);

  const none = makeHome();
  assert.equal(ensureAgyWorkerHome({ home: none, platform: 'win32', fs: winFs({ failHardLink: true }) }), null);
});

test('agyNoMcpEnv sets HOME, and USERPROFILE on win32; env unchanged when the home cannot be built', { skip: !POSIX }, () => {
  const home = makeHome();
  const env = agyNoMcpEnv({ HOME: '/elsewhere', PATH: 'p' }, { home, platform: 'linux' });
  assert.equal(env.HOME, workOf(home));
  assert.equal(env.USERPROFILE, undefined);
  assert.equal(env.PATH, 'p');

  const winEnv = agyNoMcpEnv({ USERPROFILE: 'C:\\x' }, { home, platform: 'win32', fs: winFs() });
  assert.equal(winEnv.HOME, workOf(home));
  assert.equal(winEnv.USERPROFILE, workOf(home));

  const warnings = [];
  const input = { A: '1' };
  const broken = { ...fs, symlinkSync() { throw new Error('EPERM'); }, linkSync() { throw new Error('EPERM'); } };
  const out = agyNoMcpEnv(input, { home: makeHome(), platform: 'linux', fs: broken, warn: (m) => warnings.push(m) });
  assert.equal(out, input);
  assert.equal(warnings.length, 1);
});

test('agyChildEnv: --with-mcp / req.mcp === true leaves env alone', { skip: !POSIX }, () => {
  const home = makeHome();
  const env = { HOME: '/x' };
  assert.equal(agyChildEnv(env, { withMcp: true, home }), env);
  assert.equal(agyChildEnv(env, { home }).HOME, workOf(home));
});

test('removeAgyWorkerHome removes only managed entries and never touches link targets', { skip: !POSIX }, () => {
  const home = makeHome();
  const w = ensureAgyWorkerHome({ home });
  fs.writeFileSync(path.join(w, 'mine.txt'), 'x');

  const dry = removeAgyWorkerHome({ home, dryRun: true });
  assert.ok(dry.removed.length > 0);
  assert.ok(isLink(path.join(w, '.gitconfig')));

  const r = removeAgyWorkerHome({ home });
  assert.ok(r.kept.includes(path.join(w, 'mine.txt')));
  assert.ok(gone(path.join(w, '.gitconfig')));
  assert.ok(gone(path.join(w, '.gemini', 'config', 'mcp_config.json')));
  assert.ok(fs.existsSync(path.join(w, 'mine.txt')));

  assert.equal(fs.readFileSync(path.join(home, '.gitconfig'), 'utf8'), 'git');
  assert.equal(fs.readFileSync(path.join(home, '.gemini', 'config', 'auth.json'), 'utf8'), 'auth');
  assert.equal(fs.readFileSync(path.join(home, '.gemini', 'config', 'mcp_config.json'), 'utf8'), REAL_MCP);
  assert.equal(fs.readFileSync(path.join(home, '.aos', 'go', 'token.json'), 'utf8'), 'tok');
});

test('removeAgyWorkerHome removes the worker home when nothing foreign is in it', { skip: !POSIX }, () => {
  const home = makeHome();
  const w = ensureAgyWorkerHome({ home });
  const r = removeAgyWorkerHome({ home });
  assert.deepEqual(r.kept, []);
  assert.ok(gone(w));
  assert.equal(fs.readFileSync(path.join(home, '.gemini', 'config', 'auth.json'), 'utf8'), 'auth');
});
