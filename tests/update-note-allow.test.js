// whats-new block after update + `aos allow` presets, all under a temp HOME.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { announceUpdate, markerPath } = require('../lib/whats-new');
const { allowCommand, removeAllRecorded } = require('../lib/permissions-allow');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-note-'));
const cap = () => { const b = []; return { b, write: (s) => b.push(s), text: () => b.join('') }; };
const settingsOf = (h) => JSON.parse(fs.readFileSync(path.join(h, '.claude', 'settings.json'), 'utf8'));
const REMOTE = ['remote-ci', '--host', 'u@h.example', '--key', '~/.ssh/k', '--scripts', '~/s'];

test('announceUpdate prints notes + hints and leaves a marker', () => {
    const home = tmp(); const c = cap();
    announceUpdate({ home, version: '5.4.0', write: c.write, now: 5 });
    assert.match(c.text(), /What's new in AOS 5\.4\.0/);
    assert.match(c.text(), /Router setup/);
    assert.match(c.text(), /Hub supervisor is not running/);
    assert.match(c.text(), /aos setup/);
    const m = JSON.parse(fs.readFileSync(markerPath(home), 'utf8'));
    assert.equal(m.version, '5.4.0'); assert.ok(m.hints >= 1); assert.equal(m.shown, false);
});

test('session hint shows the one-liner once', () => {
    const home = tmp();
    announceUpdate({ home, version: '5.4.0', write: () => {}, now: Date.now() });
    const hook = path.join(__dirname, '..', '.claude', 'hooks', 'aos-session-hint.mjs');
    const run = () => spawnSync(process.execPath, [hook], { input: '{}', encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } });
    assert.match(JSON.parse(run().stdout).hookSpecificOutput.additionalContext, /AOS updated to 5\.4\.0 — run `aos setup` to optimize \(\d+ hints\)/);
    assert.doesNotMatch(JSON.parse(run().stdout).hookSpecificOutput.additionalContext, /AOS updated to/);
});

test('allow: adds, merges, is idempotent, backs up', () => {
    const home = tmp();
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'x', permissions: { allow: ['Bash(ls:*)'], deny: ['Bash(rm:*)'] } }));
    assert.equal(allowCommand(REMOTE, { home, write: () => {} }), 0);
    const s = settingsOf(home);
    assert.deepEqual(s.permissions.allow, ['Bash(ls:*)', `Bash(${home}/s/*)`, 'Bash(ssh -i ~/.ssh/k u@h.example:*)']);
    assert.deepEqual(s.permissions.deny, ['Bash(rm:*)']); assert.equal(s.model, 'x');
    assert.ok(fs.readdirSync(path.join(home, '.claude')).some((f) => f.includes('aos-bak')));
    const c = cap(); allowCommand(REMOTE, { home, write: c.write });
    assert.match(c.text(), /Already allowed/); assert.equal(settingsOf(home).permissions.allow.length, 3);
});

test('allow: dry-run writes nothing; missing params fail', () => {
    const home = tmp(); const c = cap();
    assert.equal(allowCommand([...REMOTE, '--dry-run'], { home, write: c.write }), 0);
    assert.match(c.text(), /\+ permissions\.allow/); assert.ok(!fs.existsSync(path.join(home, '.claude', 'settings.json')));
    assert.equal(allowCommand(['remote-ci'], { home, write: c.write }), 2);
});

test('allow --remove reverts only what it added; pre-existing rules stay', () => {
    const home = tmp();
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(aos status:*)'] } }));
    allowCommand(['aos-tools'], { home, write: () => {} });
    assert.ok(settingsOf(home).permissions.allow.includes('Bash(aos doctor:*)'));
    allowCommand(['aos-tools', '--remove'], { home, write: () => {} });
    assert.deepEqual(settingsOf(home).permissions.allow, ['Bash(aos status:*)']);
});

test('uninstall helper removes recorded rules', () => {
    const home = tmp();
    allowCommand(['aos-tools'], { home, write: () => {} });
    assert.ok(removeAllRecorded(home) > 0);
    assert.deepEqual(settingsOf(home).permissions.allow, []);
});

test('allow: unreadable settings are never overwritten', () => {
    const home = tmp(); fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{oops');
    assert.equal(allowCommand(['aos-tools'], { home, write: () => {} }), 2);
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), '{oops');
});
