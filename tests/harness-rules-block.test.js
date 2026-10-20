// The AOS harness-rules block for ~/.gemini/RULES.md and ~/.gemini/GEMINI.md:
// managed in place, idempotent, user content never overwritten, removable by aos uninstall.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { START, END, hasHarnessRulesBlock, upsertHarnessRulesBlock, stripHarnessRulesBlock, writeManagedRulesFile } = require('../lib/harness-rules');

const root = path.join(__dirname, '..');
const RULES_BODY = fs.readFileSync(path.join(root, 'RULES.md'), 'utf8');

test('inserts the block into a file that lacks it, keeping user content', () => {
    const user = '# My gemini notes\n\nKeep this.\n';
    const out = upsertHarnessRulesBlock(user, RULES_BODY);
    assert.ok(out.startsWith(user.trimEnd()));
    assert.ok(out.includes(START));
    assert.ok(out.includes(RULES_BODY.trimEnd()));
});

test('second run is a no-op and the block appears exactly once', () => {
    const once = upsertHarnessRulesBlock('# Mine\n', RULES_BODY);
    assert.equal(upsertHarnessRulesBlock(once, RULES_BODY), once);
    assert.equal(once.split(START).length, 2);
});

test('replaces a stale block in place and never touches text outside the markers', () => {
    const stale = `before\n\n${START}\nold rules\n${END}\n\nafter\n`;
    const out = upsertHarnessRulesBlock(stale, RULES_BODY);
    assert.ok(out.startsWith('before\n\n' + START));
    assert.ok(out.endsWith(END + '\n\nafter\n'));
    assert.equal(out.split(START).length, 2);
    assert.ok(out.includes(RULES_BODY.trimEnd()));
    assert.ok(!out.includes('old rules'));
});

test('empty input yields just the block', () => {
    assert.equal(upsertHarnessRulesBlock('', RULES_BODY), `${START}\n${RULES_BODY.trimEnd()}\n${END}\n`);
});

test('hasHarnessRulesBlock detects the presence of the block', () => {
    assert.equal(hasHarnessRulesBlock(''), false);
    assert.equal(hasHarnessRulesBlock('Some normal rules'), false);
    assert.equal(hasHarnessRulesBlock(`${START}\nx\n${END}`), true);
});

test('strip restores the user file; a file that was block-only strips to empty', () => {
    const user = '# My gemini notes\n\nKeep this.\n';
    assert.equal(stripHarnessRulesBlock(upsertHarnessRulesBlock(user, RULES_BODY)), user);
    assert.equal(stripHarnessRulesBlock(upsertHarnessRulesBlock('', RULES_BODY)), '');
    assert.equal(stripHarnessRulesBlock(`before\n\n${START}\nold\n${END}\n\nafter\n`), 'before\n\nafter\n');
});

test('strip is the identity on a file without markers and keeps CRLF at the seam', () => {
    const user = '# Plain\n\n- no block here\n';
    assert.equal(stripHarnessRulesBlock(user), user);
    assert.equal(stripHarnessRulesBlock(`a\r\nb\r\n${START}\nx\n${END}\r\n`), 'a\r\nb\r\n');
});

test('the shipped RULES.md body round-trips through upsert and strip', () => {
    const composed = upsertHarnessRulesBlock('# user\n', RULES_BODY);
    assert.equal(stripHarnessRulesBlock(composed), '# user\n');
    assert.equal(upsertHarnessRulesBlock(composed, RULES_BODY), composed);
});

test('writeManagedRulesFile preserves user content in a temp HOME and is idempotent', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-harness-rules-'));
    try {
        const target = path.join(home, '.gemini', 'RULES.md');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, '# my own gemini rules\n- keep me\n');

        assert.equal(writeManagedRulesFile(target, RULES_BODY), true);
        const first = fs.readFileSync(target, 'utf8');
        assert.ok(first.startsWith('# my own gemini rules'), 'user content stays at the top');
        assert.ok(first.includes('- keep me'), 'user lines survive');
        assert.equal(first.split(START).length, 2);

        assert.equal(writeManagedRulesFile(target, RULES_BODY), false, 'second run is a no-op');
        assert.equal(fs.readFileSync(target, 'utf8'), first);

        assert.equal(stripHarnessRulesBlock(first), '# my own gemini rules\n- keep me\n');
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
});

test('writeManagedRulesFile creates the file when missing', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-harness-rules-'));
    try {
        const target = path.join(home, '.gemini', 'GEMINI.md');
        assert.equal(writeManagedRulesFile(target, RULES_BODY), true);
        const text = fs.readFileSync(target, 'utf8');
        assert.ok(text.startsWith(START));
        assert.ok(text.includes(RULES_BODY.trimEnd()));
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
});

test('installer upserts managed blocks into the gemini targets and never overwrites them wholesale', () => {
    const src = fs.readFileSync(path.join(root, 'installer.js'), 'utf8');
    assert.ok(src.includes("writeManagedRulesFile(target, rulesBody)"), 'gemini step must use the managed-block upsert');
    assert.ok(!src.includes('copyDirRecursiveSync(rulesMdSrc'), 'no wholesale copy of RULES.md');
    assert.ok(!src.includes('fs.copyFileSync(rulesMdSrc'), 'no wholesale copy into GEMINI.md');
});

test('uninstaller strips the harness-rules block from the rule files', () => {
    const src = fs.readFileSync(path.join(root, 'bin', 'aos-uninstall.mjs'), 'utf8');
    assert.ok(src.includes('stripHarnessRulesBlock'));
    assert.ok(src.includes("h('.gemini', 'RULES.md')"));
    assert.ok(src.includes("h('.gemini', 'GEMINI.md')"));
});
