const { test } = require('node:test');
const assert = require('node:assert');

const load = () => import('../.claude/hooks/go-gate.mjs');

test('comma-separated scopes are accepted and de-duplicated', async () => {
    const { parseGogate } = await load();
    const r = parseGogate('gogate grant push-feature,github-write,merge,merge 2h');
    assert.strictEqual(r.cmd, 'grant');
    assert.deepStrictEqual(r.scopes, ['push-feature', 'github-write', 'merge']);
    assert.strictEqual(r.ms, 2 * 60 * 60 * 1000);
});

test('a space after the comma or a trailing dot fails loudly instead of granting less', async () => {
    const { parseGogate } = await load();
    assert.match(parseGogate('gogate grant push-feature, github-write 2h').error, /usage: grant/);
    assert.match(parseGogate('gogate grant push-feature,github-write 3h.').error, /bad duration "3h\."/);
    assert.match(parseGogate('gogate grant push-feature,bogus 2h').error, /unknown scope bogus/);
});

test('the slash form is parsed but marked as slash (the gate ignores it without human-origin data)', async () => {
    const { parseGogate } = await load();
    assert.strictEqual(parseGogate('/gogate grant merge 2h').form, 'slash');
    assert.strictEqual(parseGogate('gogate grant merge 2h').form, 'plain');
});
