// The Tool routing block: managed in place, idempotent, user content untouched, present in every template.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { START, END, BLOCK, upsertRoutingBlock } = require('../lib/routing-rules');

const root = path.join(__dirname, '..');
const sources = [
    'RULES.md',
    'AGENTS.md',
    '.codex-plugin/system.md',
    '.github/copilot-instructions.md',
    '.cursor/rules/000_global_rules.mdc',
];
const PLAN_TRIGGER = 'If the user says "plan", "Plan", "planen" or "roadmap" with nothing else:';

test('inserts the block into a file that lacks it, keeping user content', () => {
    const user = '# My rules\n\nKeep this.\n';
    const out = upsertRoutingBlock(user);
    assert.ok(out.startsWith(user.trimEnd()));
    assert.ok(out.includes(BLOCK));
});

test('second run is a no-op and the block appears exactly once', () => {
    const once = upsertRoutingBlock('# Mine\n');
    assert.equal(upsertRoutingBlock(once), once);
    assert.equal(once.split(START).length, 2);
});

test('replaces a stale block in place and never touches text outside the markers', () => {
    const stale = `before\n\n${START}\nold wording\n${END}\n\nafter\n`;
    const out = upsertRoutingBlock(stale);
    assert.equal(out, `before\n\n${BLOCK}\n\nafter\n`);
    assert.equal(out.split(START).length, 2);
});

test('works on a real file under a temp dir', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-rrb-'));
    const file = path.join(base, 'CLAUDE.md');
    fs.writeFileSync(file, '# Global Agent Instructions\n- mine\n');
    fs.writeFileSync(file, upsertRoutingBlock(fs.readFileSync(file, 'utf8')));
    const first = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, upsertRoutingBlock(first));
    assert.equal(fs.readFileSync(file, 'utf8'), first);
    assert.ok(first.includes('- mine'));
});

test('empty input yields just the block', () => {
    assert.equal(upsertRoutingBlock(''), `${BLOCK}\n`);
});

for (const rel of sources) {
    test(`template carries the routing block exactly once: ${rel}`, () => {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        assert.equal(text.split(BLOCK).length - 1, 1, `${rel} must contain the routing block exactly once`);
        assert.equal(upsertRoutingBlock(text), text, `${rel} is not stable under upsert`);
    });
}

test('AGENTS.md routing block is identical to the lib BLOCK', () => {
    const text = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    const s = text.indexOf(START);
    const e = text.indexOf(END, s) + END.length;
    assert.equal(text.slice(s, e), BLOCK);
});

test('BLOCK carries the plan trigger as the first line of the plan-canvas paragraph', () => {
    const lines = BLOCK.split('\n');
    const i = lines.findIndex((l) => l.startsWith(PLAN_TRIGGER));
    assert.ok(i > 0, 'plan trigger line missing');
    assert.ok(lines[i + 1].startsWith('**plan-canvas**'));
    assert.ok(lines[i - 1] === '', 'trigger must open the paragraph');
});

test('plan-canvas skill description carries the plan, planen and roadmap triggers', () => {
    const text = fs.readFileSync(path.join(root, 'skills/global_config/plan-canvas/SKILL.md'), 'utf8');
    const front = text.split('---')[1];
    for (const word of ['"plan"', '"planen"', '"roadmap"']) assert.ok(front.includes(word), `missing ${word}`);
});

test('installer wraps every destructive upsert with the routing upsert', () => {
    const src = fs.readFileSync(path.join(root, 'installer.js'), 'utf8');
    const all = src.match(/upsertDestructiveBlock\(/g).length;
    const wrapped = src.match(/upsertRoutingBlock\(upsertDestructiveBlock\(/g)?.length ?? 0;
    assert.equal(wrapped, all, 'every upsertDestructiveBlock call must be wrapped');
});
