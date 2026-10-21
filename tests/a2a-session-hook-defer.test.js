// Codex SessionStart showed one unnamed "Failed" hook and no codex-* sidecar on Windows: the slow harness-pid walk ran inside the
// 10 s hook. The hook now replies at once, finishes detached, never fails, and logs every error to ~/.aos/logs/a2a-session.log.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', '.claude', 'hooks', 'a2a-session.mjs');
const run = (home, args, input, env = {}) => {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [HOOK, ...args], { input, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, AOS_A2A_HOOK_DEFER: '1', ...env }, timeout: 15000 });
    return { ...r, ms: Date.now() - t0 };
};
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
const logOf = (home) => { try { return fs.readFileSync(path.join(home, '.aos', 'logs', 'a2a-session.log'), 'utf8'); } catch { return ''; } };

test('deferred hook replies with the peer name, exits 0 fast, and the detached finisher starts the sidecar', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-a2a-hook-'));
    const r = run(home, ['--harness', 'codex'], JSON.stringify({ session_id: 'abcdef12-0000' }));
    assert.equal(r.status, 0);
    assert.ok(r.ms < 3000, `hook took ${r.ms} ms`);
    assert.match(JSON.parse(r.stdout.trim()).hookSpecificOutput.additionalContext, /peer name is codex-abcdef12/);
    const pidfile = path.join(home, '.aos', 'sessions', 'codex-abcdef12.pid');
    const pid = await waitFor(() => { try { return Number(fs.readFileSync(pidfile, 'utf8')); } catch { return 0; } });
    if (pid) try { process.kill(pid); } catch { /* already gone */ }
    assert.ok(pid, 'the finisher spawned the sidecar; log: ' + logOf(home));
});

test('errors never fail the hook and land in the log', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-a2a-hook-'));
    const bad = run(home, ['--harness', 'codex'], 'not json');
    assert.equal(bad.status, 0);
    assert.match(logOf(home), /codex stdin:/);
    // no session id: the finisher's ensureSidecar refuses a codex session without a thread, and says so
    const none = run(home, ['--harness', 'codex'], JSON.stringify({}));
    assert.equal(none.status, 0);
    assert.equal(none.stdout.trim(), '');
    assert.ok(await waitFor(() => /codex finish ensureSidecar: codex mode needs a thread/.test(logOf(home))), logOf(home));
});

test('the off switch skips everything, quietly', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-a2a-hook-'));
    const r = run(home, ['--harness', 'codex'], JSON.stringify({ session_id: 'abcdef12' }), { AOS_A2A_SIDECAR: 'off' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
});
