const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('repo .claude/settings.json has no hooks key (installed hooks are the only source)', () => {
    const s = readJson('.claude/settings.json');
    assert.ok(!('hooks' in s), 'hooks belong in config/claude-hooks.json, or they run twice in an AOS checkout');
    assert.ok(Array.isArray(s.permissions && s.permissions.allow));
});

test('config/claude-hooks.json is the hook template: hooks only, one repo-anchored dispatcher entry per event', () => {
    const t = readJson('config/claude-hooks.json');
    assert.deepStrictEqual(Object.keys(t), ['hooks']);
    const byMatcher = Object.fromEntries(t.hooks.PreToolUse.map((e) => [e.matcher || '*', e.hooks.map((h) => h.command)]));
    assert.deepStrictEqual(Object.keys(byMatcher), ['Bash', 'Write|Edit|MultiEdit|NotebookEdit', 'Agent|Task', '*']);
    assert.ok(byMatcher.Bash[0].startsWith('node "${CLAUDE_PROJECT_DIR}/.claude/hooks/aos-hooks.mjs" PreToolUse go-gate.mjs'), byMatcher.Bash[0]);
    assert.ok(byMatcher.Bash[0].endsWith('|| exit 2'), 'the gate stays fail-closed, for Bash only');
    for (const k of ['Write|Edit|MultiEdit|NotebookEdit', 'Agent|Task', '*']) assert.ok(!byMatcher[k][0].includes('exit 2') && !byMatcher[k][0].includes('go-gate'), k);
    assert.ok(byMatcher['*'][0].endsWith('trail-relay.mjs --rest'));
    for (const [event, entries] of Object.entries(t.hooks)) {
        const cmds = entries.flatMap((e) => e.hooks).map((h) => h.command);
        assert.strictEqual(cmds.length, event === 'PreToolUse' ? 4 : 1, `${event}: one process per event and matcher`);
        if (event !== 'SessionEnd') assert.ok(cmds[0].includes(`aos-hooks.mjs" ${event} `), cmds[0]);
    }
});

test('the installer reads the template from config/claude-hooks.json', () => {
    const src = fs.readFileSync(path.join(ROOT, 'installer.js'), 'utf8');
    assert.match(src, /path\.join\(srcDir, 'config', 'claude-hooks\.json'\)/);
    assert.ok(!/path\.join\(srcDir, '\.claude', 'settings\.json'\)/.test(src));
});

test('npm pack ships config/claude-hooks.json', () => {
    const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.strictEqual(r.status, 0, r.stderr);
    const files = JSON.parse(r.stdout)[0].files.map((f) => f.path);
    assert.ok(files.includes('config/claude-hooks.json'));
});
