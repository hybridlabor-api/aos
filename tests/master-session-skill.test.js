const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'skills', 'basic', 'master-session', 'SKILL.md');
const md = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const lines = md.split('\n').length;

test('master-session skill exists with the contract frontmatter', () => {
    assert.ok(md, 'SKILL.md missing');
    assert.match(md, /^name: master-session$/m);
    assert.match(md, /^category: bdb-core$/m);
    assert.match(md, /^risk: safe$/m);
    assert.ok(lines >= 80 && lines <= 140, `expected ~80-120 lines, got ${lines}`);
});

test('covers both modes, the roster, the GO board and the handover', () => {
    for (const re of [/Adopt/, /Spawn/, /ListAgents/, /SendMessage/, /roster/i, /GO board/i, /handover/i,
        /--permission-mode auto/, /--disallowedTools/, /variadic/, /ao-orchestrator/, /notify_when_idle/]) {
        assert.match(md, re);
    }
});

test('states the boundaries and the GO-token protocol', () => {
    assert.match(md, /never grants GO/i);
    assert.match(md, /verbatim/i);
    assert.match(md, /forwarded/i);
    assert.match(md, /GO <session/);
    assert.match(md, /go-token\.mjs/);
    assert.match(md, /~\/\.aos\/go\//);
    assert.match(md, /10 minutes/);
});

test('status request asks exactly five questions in at most 10 lines', () => {
    const block = md.match(/```status-request\n([\s\S]*?)```/);
    assert.ok(block, 'status-request block missing');
    const body = block[1].trim().split('\n');
    assert.ok(body.length <= 10);
    assert.equal(body.filter((l) => /^\d\./.test(l)).length, 5);
});
