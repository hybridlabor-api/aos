'use strict';
// Skill packs: resolution, exclusion rules, settings/flag parsing, library population
// and manifest-aware deselection. Runs against a throwaway HOME.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.AOS_TEST_SANDBOX = '1';
delete process.env.CLAUDE_CONFIG_DIR; // keep ~/.claude deterministic under the throwaway HOME
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-packs-'));
const HOME = process.env.HOME;

const skillPacks = require('../lib/skill-packs');
const v5Profile = require('../lib/v5/profile');
const installer = require('../installer.js');

const ROOT = path.join(__dirname, '..');

test('pack resolution: plain packs, group packs and the app-dev shortcut', () => {
    assert.ok(skillPacks.packSkillNames(ROOT, 'live-show').includes('bdb-grandma3-mcp'));
    assert.ok(skillPacks.packSkillNames(ROOT, 'stacks').includes('prisma-expert'), 'stacks flattens every group');
    assert.ok(skillPacks.packSkillNames(ROOT, 'stacks').includes('bash-linux'));
    assert.deepStrictEqual(skillPacks.normalizeSelection(['app-dev'], ROOT), ['app-dev', 'stacks']);
    assert.deepStrictEqual(skillPacks.normalizeSelection(['nope', 'live-show', 'live-show'], ROOT), ['live-show']);
    assert.strictEqual(skillPacks.normalizeSelection('live-show', ROOT), null);
});

test('selection: base is always in; no stored selection excludes nothing', () => {
    const selected = skillPacks.selectedSkillNames(ROOT, ['live-show']);
    assert.ok(selected.includes('bdbrainstorm'), 'base always in');
    assert.ok(selected.includes('bdb-resolume-mcp'));
    assert.ok(!selected.includes('remotion'), 'creator skill not selected');
    assert.deepStrictEqual(skillPacks.excludedByPacks(ROOT, null), [], 'no selection: keep every skill');
    const excluded = skillPacks.excludedByPacks(ROOT, ['live-show']);
    assert.ok(excluded.includes('remotion'));
    assert.ok(!excluded.includes('bdbrainstorm'), 'base never excluded');
    assert.ok(!excluded.includes('bdb-grandma3-mcp'), 'pack skill not excluded');
    const excludedAppDev = skillPacks.excludedByPacks(ROOT, ['app-dev']);
    assert.ok(excludedAppDev.includes('bdb-grandma3-mcp'), 'stacks rides along with app-dev');
    assert.ok(!excludedAppDev.includes('prisma-expert'));
});

test('--packs flag: values, none, unknown, app-dev expansion', () => {
    const o = v5Profile.parseOptions(['aos', '--packs=live-show,web-design']);
    assert.deepStrictEqual(o.packs, ['live-show', 'web-design']);
    assert.strictEqual(o.packsFromFlag, true);
    const a = v5Profile.parseOptions(['aos', '--packs=app-dev']);
    assert.ok(a.packs.includes('stacks'));
    assert.deepStrictEqual(v5Profile.parseOptions(['aos', '--packs=none']).packs, []);
    assert.throws(() => v5Profile.parseOptions(['aos', '--packs=bogus-pack']), /Unknown pack/);
    assert.throws(() => v5Profile.parseOptions(['aos', '--packs=']), /needs a value/);
    assert.strictEqual(v5Profile.parseOptions(['aos']).packs, undefined);
});

test('settings: packs is an owned key and sanitized to pack-shaped names', () => {
    const { settings, problems } = v5Profile.sanitizeSettings({ packs: ['live-show', 'BAD NAME', 'live-show', 5], skillSet: 'core' });
    assert.deepStrictEqual(settings.packs, ['live-show']);
    assert.strictEqual(problems.length, 1);
    assert.ok(v5Profile.OWNED_KEYS.includes('packs'));
});

test('resolve: flag wins over stored setting; absent setting keeps everything', () => {
    const st = { packs: ['business'] };
    assert.deepStrictEqual(v5Profile.resolve({ without: [], packsFromFlag: true, packs: ['live-show'] }, st).packs, ['live-show']);
    assert.deepStrictEqual(v5Profile.resolve({ without: [] }, st).packs, ['business']);
    assert.strictEqual(v5Profile.resolve({ without: [] }, {}).packs, null);
});

test('populateSkillLibrary copies every shipped skill and writes the pack index', () => {
    installer.populateSkillLibrary(HOME);
    const lib = skillPacks.librarySkillsDir(HOME);
    assert.ok(fs.existsSync(path.join(lib, 'bdbrainstorm', 'SKILL.md')), 'nested category flattened');
    assert.ok(fs.existsSync(path.join(lib, 'memb-ingest', 'SKILL.md')));
    const idx = JSON.parse(fs.readFileSync(skillPacks.libraryIndexFile(HOME), 'utf8'));
    assert.ok(Array.isArray(idx.base) && idx.base.includes('bdbrainstorm'));
    assert.ok(idx.packs['live-show'].skills.includes('bdb-grandma3-mcp'));
});

test('applyPackSelection removes deselected skills the manifest lists, keeps store installs and user skills', () => {
    const manifest = {};
    const writeSkill = (root, name, files) => {
        const dir = path.join(root, name);
        fs.mkdirSync(dir, { recursive: true });
        for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), body);
        return dir;
    };
    const hash = (p) => require('node:crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    const remotionDir = writeSkill(path.join(HOME, '.claude', 'skills'), 'remotion', { 'SKILL.md': 'remotion\n' });
    manifest[path.join(remotionDir, 'SKILL.md')] = { sha256: hash(path.join(remotionDir, 'SKILL.md')) };
    // A user skill with no manifest entry: must survive.
    writeSkill(path.join(HOME, '.agents', 'skills'), 'my-own-skill', { 'SKILL.md': 'mine\n' });
    // Store-installed skill: deselected pack math, but the store owns it.
    const storeDir = writeSkill(path.join(HOME, '.agents', 'skills'), 'remotion', { 'SKILL.md': 'remotion\n' });
    manifest[path.join(storeDir, 'SKILL.md')] = { sha256: hash(path.join(storeDir, 'SKILL.md')) };
    fs.mkdirSync(path.join(HOME, '.aos', 'store'), { recursive: true });
    fs.writeFileSync(path.join(HOME, '.aos', 'store', 'installs.jsonl'), JSON.stringify({ kind: 'skill', name: 'remotion' }) + '\n');

    // Selection drives the exclude list.
    v5Profile.writeSettings(HOME, { packs: ['live-show'] });
    installer.applyInstallOptions(HOME);
    assert.ok(installer.currentPackSelection().includes('live-show'));
    assert.ok(installer.getTierExcludeSkills('1').includes('remotion'));

    installer.applyPackSelection(manifest);
    assert.ok(!fs.existsSync(remotionDir), 'deselected, manifest-listed copy removed');
    assert.ok(fs.existsSync(storeDir), 'store-installed copy stays');
    assert.ok(fs.existsSync(path.join(HOME, '.agents', 'skills', 'my-own-skill', 'SKILL.md')), 'user skill stays');

    // No stored selection: nothing is removed.
    const m2 = {};
    v5Profile.writeSettings(HOME, {});
    installer.applyInstallOptions(HOME);
    assert.strictEqual(installer.currentPackSelection(), null);
    installer.applyPackSelection(m2);
    assert.ok(fs.existsSync(storeDir));
});

test('applyInstallOptions reads a stored packs setting from v5-settings.json', () => {
    v5Profile.writeSettings(HOME, { packs: ['business'] });
    installer.applyInstallOptions(HOME);
    assert.deepStrictEqual(installer.currentPackSelection(), ['business']);
    v5Profile.writeSettings(HOME, { packs: [] });
    installer.applyInstallOptions(HOME);
    assert.deepStrictEqual(installer.currentPackSelection(), []);
});
