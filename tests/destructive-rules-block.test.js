// The Destructive Actions block: managed in place, idempotent, user content untouched, present in every template.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { START, END, BLOCK, upsertDestructiveBlock } = require('../lib/destructive-rules');

const root = path.join(__dirname, '..');
const sources = [
    'RULES.md',
    'AGENTS.md',
    '.codex-plugin/system.md',
    '.github/copilot-instructions.md',
    '.cursor/rules/000_global_rules.mdc',
];

test('inserts the block into a file that lacks it, keeping user content', () => {
    const user = '# My rules\n\nKeep this.\n';
    const out = upsertDestructiveBlock(user);
    assert.ok(out.startsWith(user.trimEnd()));
    assert.ok(out.includes(BLOCK));
});

test('second run is a no-op', () => {
    const once = upsertDestructiveBlock('# Mine\n');
    assert.equal(upsertDestructiveBlock(once), once);
});

test('replaces a stale block in place and never touches text outside the markers', () => {
    const stale = `before\n\n${START}\nold wording\n${END}\n\nafter\n`;
    const out = upsertDestructiveBlock(stale);
    assert.equal(out, `before\n\n${BLOCK}\n\nafter\n`);
    assert.equal(out.split(START).length, 2);
});

test('works on a real file under a temp HOME', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-drb-'));
    const file = path.join(base, 'CLAUDE.md');
    fs.writeFileSync(file, '# Global Agent Instructions\n- mine\n');
    fs.writeFileSync(file, upsertDestructiveBlock(fs.readFileSync(file, 'utf8')));
    const first = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, upsertDestructiveBlock(first));
    assert.equal(fs.readFileSync(file, 'utf8'), first);
    assert.ok(first.includes('- mine'));
});

test('empty input yields just the block', () => {
    assert.equal(upsertDestructiveBlock(''), `${BLOCK}\n`);
});

for (const rel of sources) {
    test(`template carries the block verbatim: ${rel}`, () => {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        assert.ok(text.includes(BLOCK), `${rel} is missing the Destructive Actions block`);
        assert.equal(upsertDestructiveBlock(text), text, `${rel} is not stable under upsert`);
    });
}

test('installer wires the helper into the CLAUDE.md, copilot and codex writers', () => {
    const src = fs.readFileSync(path.join(root, 'installer.js'), 'utf8');
    assert.equal(src.split('upsertDestructiveBlock(').length - 1, 4);
});
