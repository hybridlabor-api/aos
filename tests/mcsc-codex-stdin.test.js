const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const hasDeps = fs.existsSync(path.join(root, 'mcps', 'mcsc', 'node_modules', '@modelcontextprotocol'));

// Regression: the codex adapter spawns with stdin 'ignore' and used to call child.stdin.end() on null.
test('codex adapter delegate() completes with stdin ignored (no TypeError on child.stdin)', { skip: hasDeps ? false : 'mcps/mcsc/node_modules missing' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsc-codex-'));
    fs.writeFileSync(path.join(dir, 'codex'), '#!/bin/sh\necho \'{"type":"turn.completed","last_agent_message":"native ok"}\'\n', { mode: 0o755 });
    const savedPath = process.env.PATH;
    process.env.AGENTTRAIL_PORT = '1';
    try {
        process.env.PATH = `${dir}:${savedPath}`;
        const { delegate } = await import(path.join(root, 'mcps', 'mcsc', 'packages', 'core', 'src', 'adapters', 'codex.js'));
        const r = await delegate({ prompt: 'hello', cwd: dir });
        assert.equal(r.exit, 0, JSON.stringify(r));
        assert.equal(r.output, 'native ok');
    } finally {
        process.env.PATH = savedPath;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
