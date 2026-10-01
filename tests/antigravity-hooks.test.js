const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const installer = require('../installer.js');
const { agyHookCommand } = installer;
// The real self-check needs the scripts on disk; tests/windows-hooks.test.js covers that path.
const okSpawn = () => ({ status: 0, stderr: '' });
const mergeAntigravityHooks = (p, o = {}) => installer.mergeAntigravityHooks(p, { selfCheck: okSpawn, ...o });

const GROUPED = ['PreToolUse', 'PostToolUse'];
const FLAT = ['PreInvocation', 'PostInvocation', 'Stop'];

// Mirrors the rules in agy's hooks.md: grouped events need matcher+hooks, flat events hold handlers, command is required.
function validate(file) {
    const errors = [];
    const handler = (h, where) => {
        if (!h || typeof h.command !== 'string' || !h.command) errors.push(`${where}: handler lacks command`);
        else if (h.timeout !== undefined && !(Number.isInteger(h.timeout) && h.timeout > 0 && h.timeout <= 60)) errors.push(`${where}: bad timeout ${h.timeout}`);
    };
    for (const [name, spec] of Object.entries(file)) {
        for (const ev of GROUPED) {
            for (const [i, g] of (spec[ev] || []).entries()) {
                if (typeof g.matcher !== 'string') errors.push(`${name}.${ev}[${i}]: no matcher`);
                if (!Array.isArray(g.hooks)) errors.push(`${name}.${ev}[${i}]: no hooks`);
                else g.hooks.forEach((h, j) => handler(h, `${name}.${ev}[${i}].hooks[${j}]`));
            }
        }
        for (const ev of FLAT) (spec[ev] || []).forEach((h, i) => handler(h, `${name}.${ev}[${i}]`));
    }
    return errors;
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agy-hooks-'));
const foreign = { type: 'command', command: './my-own-stop.sh', timeout: 5 };
const brokenOld = {
    hooks: {
        PreToolUse: [
            { matcher: 'run_command|Bash', hooks: [{ type: 'command', command: 'node "/x/go-gate.mjs"', timeout: 10000 }] },
            { hooks: [{ type: 'command', command: 'node "/x/trail-relay.mjs" --agent agy', timeout: 2000 }] }
        ],
        Stop: [
            { hooks: [{ type: 'command', command: 'node "/x/graph-gate.mjs"', timeout: 10000 }] },
            { hooks: [foreign] }
        ],
        PreInvocation: [{ hooks: [{ type: 'command', command: 'node "/x/memb-inject.mjs"', timeout: 8000 }] }]
    },
    other: { Stop: [foreign] }
};

test('fresh output is valid per agy hook format', () => {
    const p = path.join(tmp(), 'hooks.json');
    mergeAntigravityHooks(p);
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.deepStrictEqual(validate(data), []);
    assert.ok(data.hooks.PreToolUse.length >= 3);
    assert.ok(data.hooks.Stop.length >= 2 && data.hooks.Stop.every((h) => h.command));
    assert.ok(data.hooks.PreInvocation.every((h) => h.command));
});

test('migrates the old broken shape, keeps foreign handlers, is idempotent', () => {
    const dir = tmp();
    const p = path.join(dir, 'hooks.json');
    fs.writeFileSync(p, JSON.stringify(brokenOld));
    assert.notDeepStrictEqual(validate(brokenOld.hooks && { hooks: brokenOld.hooks }), []);
    mergeAntigravityHooks(p);
    const first = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(first);
    assert.deepStrictEqual(validate(data), []);
    assert.strictEqual(data.hooks.Stop.filter((h) => h.command === foreign.command).length, 1);
    assert.deepStrictEqual(data.other, { Stop: [foreign] });
    mergeAntigravityHooks(p);
    assert.strictEqual(fs.readFileSync(p, 'utf8'), first);
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

const allCommands = (data) => JSON.stringify(data).match(/"command":"(?:[^"\\]|\\.)*"/g).map((c) => JSON.parse(`{${c}}`).command);

test('agy commands are relative, unquoted, and observability hooks fail open', () => {
    const p = path.join(tmp(), 'hooks.json');
    mergeAntigravityHooks(p);
    const cmds = allCommands(JSON.parse(fs.readFileSync(p, 'utf8')));
    assert.ok(cmds.length >= 7);
    for (const c of cmds) assert.ok(!c.includes('"') && !c.includes('\\'), c);
    assert.ok(cmds.includes('node hooks/go-gate.mjs'));
    assert.ok(cmds.includes('node hooks/trail-relay.mjs --agent agy --event PreToolUse || exit 0'));
    assert.ok(cmds.includes('node hooks/memb-inject.mjs || exit 0'));
    assert.ok(cmds.includes('node workflows/startcycle-dispatch.mjs'));
    for (const c of cmds.filter((x) => /go-gate|graph-gate|conventional|env-file/.test(x))) assert.ok(!c.includes('||'), c);
});

test('agyHookCommand rejects scripts outside the hooks.json folder or with unsafe paths', () => {
    assert.strictEqual(agyHookCommand('/a/b', '/a/b/hooks/x.mjs', ' --k v'), 'node hooks/x.mjs --k v');
    assert.throws(() => agyHookCommand('/a/b', '/a/c/x.mjs'));
    assert.throws(() => agyHookCommand('/a/b', '/a/b/my hooks/x.mjs'));
});
