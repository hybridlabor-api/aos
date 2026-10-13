'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { ensureClaudeDefaultMode, installGlobalHooks } = require('../installer.js');
const { backupOf } = require('../lib/backup-once.js');

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-defmode-test-'));

test('ensureClaudeDefaultMode: sets defaultMode="auto" when permissions is absent', () => {
    const dir = makeTempDir();
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', otherKey: 123 }, null, 2));

    const changed = ensureClaudeDefaultMode(settingsPath, { dryRun: false });
    assert.strictEqual(changed, true);

    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.strictEqual(s.theme, 'dark');
    assert.strictEqual(s.otherKey, 123);
    assert.strictEqual(s.permissions.defaultMode, 'auto');
});

test('ensureClaudeDefaultMode: sets defaultMode="auto" when permissions exists without defaultMode', () => {
    const dir = makeTempDir();
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
        permissions: {
            allow: ['Bash(git status:*)'],
            deny: ['Bash(rm * ~)']
        }
    }, null, 2));

    const changed = ensureClaudeDefaultMode(settingsPath, { dryRun: false });
    assert.strictEqual(changed, true);

    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.strictEqual(s.permissions.defaultMode, 'auto');
    assert.deepStrictEqual(s.permissions.allow, ['Bash(git status:*)']);
    assert.deepStrictEqual(s.permissions.deny, ['Bash(rm * ~)']);
});

test('ensureClaudeDefaultMode: never overwrites existing defaultMode ("ask", "plan", "auto", "bypass")', () => {
    const modes = ['ask', 'plan', 'auto', 'bypass', 'custom'];
    for (const mode of modes) {
        const dir = makeTempDir();
        const settingsPath = path.join(dir, 'settings.json');
        fs.writeFileSync(settingsPath, JSON.stringify({
            permissions: {
                defaultMode: mode,
                allow: ['Bash(ls:*)']
            }
        }, null, 2));

        const changed = ensureClaudeDefaultMode(settingsPath, { dryRun: false });
        assert.strictEqual(changed, false, `should not modify when defaultMode is ${mode}`);

        const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.strictEqual(s.permissions.defaultMode, mode);
        assert.deepStrictEqual(s.permissions.allow, ['Bash(ls:*)']);
    }
});

test('ensureClaudeDefaultMode: is idempotent when called repeatedly', () => {
    const dir = makeTempDir();
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: { PreToolUse: [] } }, null, 2));

    const first = ensureClaudeDefaultMode(settingsPath, { dryRun: false });
    assert.strictEqual(first, true);

    const beforeSecond = fs.readFileSync(settingsPath, 'utf8');
    const second = ensureClaudeDefaultMode(settingsPath, { dryRun: false });
    assert.strictEqual(second, false);

    const afterSecond = fs.readFileSync(settingsPath, 'utf8');
    assert.strictEqual(beforeSecond, afterSecond);
});

test('ensureClaudeDefaultMode: creates settings file if absent', () => {
    const dir = makeTempDir();
    const settingsPath = path.join(dir, 'nested', 'settings.json');

    assert.strictEqual(fs.existsSync(settingsPath), false);
    const changed = ensureClaudeDefaultMode(settingsPath, { dryRun: false });
    assert.strictEqual(changed, true);
    assert.strictEqual(fs.existsSync(settingsPath), true);

    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.strictEqual(s.permissions.defaultMode, 'auto');
});

test('ensureClaudeDefaultMode: respects dry-run and writes nothing', () => {
    const dir = makeTempDir();
    const settingsPath = path.join(dir, 'settings.json');
    const original = JSON.stringify({ permissions: { allow: ['Bash(a)'] } }, null, 2);
    fs.writeFileSync(settingsPath, original);

    const changed = ensureClaudeDefaultMode(settingsPath, { dryRun: true });
    assert.strictEqual(changed, false);

    const content = fs.readFileSync(settingsPath, 'utf8');
    assert.strictEqual(content, original);

    const baks = fs.readdirSync(dir).filter(f => f.endsWith('.bak'));
    assert.strictEqual(baks.length, 0, 'dry-run must not create backups');
});

test('ensureClaudeDefaultMode: respects backupOnce and preserves pre-run state in backup', () => {
    const dir = makeTempDir();
    const settingsPath = path.join(dir, 'settings.json');
    const original = JSON.stringify({ theme: 'light', mySetting: 42 });
    fs.writeFileSync(settingsPath, original);

    const changed = ensureClaudeDefaultMode(settingsPath, { dryRun: false });
    assert.strictEqual(changed, true);

    const baks = fs.readdirSync(dir).filter(f => f.endsWith('.bak'));
    assert.strictEqual(baks.length, 1, 'exactly one backup file created');
    assert.strictEqual(fs.readFileSync(path.join(dir, baks[0]), 'utf8'), original);
    assert.strictEqual(backupOf(settingsPath), path.join(dir, baks[0]));

    // A second call in the same process does not create another backup
    ensureClaudeDefaultMode(settingsPath, { dryRun: false });
    const baksAfter = fs.readdirSync(dir).filter(f => f.endsWith('.bak'));
    assert.strictEqual(baksAfter.length, 1);
});

test('ensureClaudeDefaultMode: safely skips unparseable JSON or non-object permissions without corrupting', () => {
    const dir = makeTempDir();

    // Invalid JSON
    const badJson = path.join(dir, 'bad.json');
    fs.writeFileSync(badJson, '{ not valid json');
    assert.strictEqual(ensureClaudeDefaultMode(badJson, { dryRun: false }), false);
    assert.strictEqual(fs.readFileSync(badJson, 'utf8'), '{ not valid json');

    // Non-object permissions (string)
    const badPerms = path.join(dir, 'badperms.json');
    fs.writeFileSync(badPerms, JSON.stringify({ permissions: 'invalid' }));
    assert.strictEqual(ensureClaudeDefaultMode(badPerms, { dryRun: false }), false);
    assert.strictEqual(fs.readFileSync(badPerms, 'utf8'), JSON.stringify({ permissions: 'invalid' }));

    // Non-object permissions (array)
    const arrayPerms = path.join(dir, 'arrayperms.json');
    fs.writeFileSync(arrayPerms, JSON.stringify({ permissions: ['invalid'] }));
    assert.strictEqual(ensureClaudeDefaultMode(arrayPerms, { dryRun: false }), false);
    assert.strictEqual(fs.readFileSync(arrayPerms, 'utf8'), JSON.stringify({ permissions: ['invalid'] }));
});

test('installGlobalHooks: sets permissions.defaultMode="auto" on fresh install and keeps user setting on update', () => {
    const targetHome = makeTempDir();
    const targetGemini = path.join(targetHome, '.gemini');
    const claudeSettings = path.join(targetHome, '.claude', 'settings.json');

    // 1. Fresh install
    installGlobalHooks({ targetHome, targetGemini, harnesses: new Set(['claudecode']) });
    assert.strictEqual(fs.existsSync(claudeSettings), true);

    const fresh = JSON.parse(fs.readFileSync(claudeSettings, 'utf8'));
    assert.strictEqual(fresh.permissions.defaultMode, 'auto', 'fresh install sets defaultMode="auto"');
    assert.ok(Array.isArray(fresh.permissions.deny), 'deny rules are present');
    assert.ok(fresh.hooks && typeof fresh.hooks === 'object', 'hooks are present');

    // 2. User updates defaultMode to "ask"
    fresh.permissions.defaultMode = 'ask';
    fs.writeFileSync(claudeSettings, JSON.stringify(fresh, null, 2));

    // 3. Update run (installGlobalHooks runs again)
    installGlobalHooks({ targetHome, targetGemini, harnesses: new Set(['claudecode']) });

    const updated = JSON.parse(fs.readFileSync(claudeSettings, 'utf8'));
    assert.strictEqual(updated.permissions.defaultMode, 'ask', 'update keeps user-chosen defaultMode="ask"');
    assert.ok(Array.isArray(updated.permissions.deny), 'deny rules still present');
});
