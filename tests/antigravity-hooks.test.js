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

// Mirrors the rules in agy's hooks.md: top-level keys are named hooks; grouped events need matcher+hooks,
// flat events hold handlers, command is required, and a named hook must carry at least one event.
function validate(file) {
    const errors = [];
    const handler = (h, where) => {
        if (!h || typeof h.command !== 'string' || !h.command) errors.push(`${where}: handler lacks command`);
        else if (h.timeout !== undefined && !(Number.isInteger(h.timeout) && h.timeout > 0 && h.timeout <= 60)) errors.push(`${where}: bad timeout ${h.timeout}`);
    };
    for (const [name, spec] of Object.entries(file)) {
        if (!spec || typeof spec !== 'object') { errors.push(`${name}: not a hook spec`); continue; }
        if (![...GROUPED, ...FLAT].some((ev) => Array.isArray(spec[ev]) && spec[ev].length)) errors.push(`${name}: empty named hook`);
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
const NAMES = ['aos-go-gate', 'aos-conventional-commits', 'aos-env-protection', 'aos-trail-relay', 'aos-graph-gate', 'aos-context'];

test('fresh output is valid per agy hook format: one named, non-empty hook per concern', () => {
    const p = path.join(tmp(), 'hooks.json');
    mergeAntigravityHooks(p);
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.deepStrictEqual(validate(data), []);
    assert.deepStrictEqual(Object.keys(data).sort(), [...NAMES].sort());
    assert.strictEqual(data['aos-go-gate'].PreToolUse[0].matcher, 'run_command|Bash');
    assert.strictEqual(data['aos-go-gate'].PreToolUse[0].hooks[0].command, 'node hooks/go-gate.mjs');
    assert.ok(data['aos-trail-relay'].PreToolUse[0].hooks[0].command.includes('trail-relay.mjs'));
    assert.ok(data['aos-context'].PreInvocation.length === 2);
});

test('named format has no top-level "hooks" key and wires every AOS hook script', () => {
    const p = path.join(tmp(), 'hooks.json');
    mergeAntigravityHooks(p);
    const raw = fs.readFileSync(p, 'utf8');
    assert.ok(!('hooks' in JSON.parse(raw)));
    for (const s of ['go-gate', 'graph-gate', 'memb-inject', 'trail-relay', 'startcycle-dispatch', 'conventional-commits', 'env-file-protection']) {
        assert.ok(raw.includes(`${s}.mjs`), `${s}.mjs missing from agy hooks.json`);
    }
});

test('migrates the legacy "hooks" lump, keeps foreign handlers and other names, is idempotent', () => {
    const dir = tmp();
    const p = path.join(dir, 'hooks.json');
    fs.writeFileSync(p, JSON.stringify(brokenOld));
    mergeAntigravityHooks(p);
    const first = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(first);
    assert.deepStrictEqual(validate(data), []);
    assert.deepStrictEqual(data.hooks, { Stop: [foreign] }, 'only the foreign handler stays in the old lump');
    assert.deepStrictEqual(data.other, { Stop: [foreign] });
    for (const n of NAMES) assert.ok(data[n], n);
    mergeAntigravityHooks(p);
    assert.strictEqual(fs.readFileSync(p, 'utf8'), first);
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

test('an old lump holding only AOS handlers disappears', () => {
    const p = path.join(tmp(), 'hooks.json');
    fs.writeFileSync(p, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node hooks/graph-gate.mjs' }] }] } }));
    mergeAntigravityHooks(p);
    assert.ok(!('hooks' in JSON.parse(fs.readFileSync(p, 'utf8'))));
});

test('writes through a symlink (agy links antigravity-cli/hooks.json to config/hooks.json)', { skip: process.platform === 'win32' }, () => {
    const dir = tmp();
    const real = path.join(dir, 'config', 'hooks.json');
    const link = path.join(dir, 'cli', 'hooks.json');
    fs.mkdirSync(path.dirname(real)); fs.mkdirSync(path.dirname(link));
    fs.writeFileSync(real, '{}');
    fs.symlinkSync(real, link);
    mergeAntigravityHooks(link);
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.ok(JSON.parse(fs.readFileSync(real, 'utf8'))['aos-go-gate']);
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

// Real agy 1.2.14, no model call: an unauthenticated `agy -p` logs the hook load and exits at the login prompt.
test('real agy loads every AOS named hook (AOS_E2E_CLI=1)', { skip: process.env.AOS_E2E_CLI !== '1' }, () => {
    const { spawnSync } = require('node:child_process');
    const home = tmp();
    const cfg = path.join(home, '.gemini', 'config');
    fs.mkdirSync(path.join(cfg, 'hooks'), { recursive: true });
    mergeAntigravityHooks(path.join(cfg, 'hooks.json'));
    const log = path.join(home, 'agy.log');
    // Port 9 is closed, so even a credential found on the machine cannot reach a model.
    spawnSync('agy', ['-p', 'x', '--print-timeout', '10s', '--log-file', log], { env: { ...process.env, HOME: home, USERPROFILE: home, ANTIGRAVITY_BASE_URL: 'http://127.0.0.1:9' }, timeout: 30000, stdio: 'ignore' });
    const text = fs.readFileSync(log, 'utf8');
    assert.match(text, new RegExp(`loaded ${NAMES.length} named hooks from 1 hooks.json file`));
    assert.ok(!/skipping component[^\n]*aos-/.test(text), 'no AOS hook is skipped as empty');
    fs.rmSync(home, { recursive: true, force: true });
});

// Fires the written go-gate command the way agy does (sh -c, cwd = hooks.json folder, camelCase payload on
// stdin). agy's own decision handling needs a model turn and stays unverified; the hook side is deterministic.
test('written go-gate command answers agy PreToolUse payloads with the decision contract', { skip: process.platform === 'win32' }, () => {
    const { spawnSync } = require('node:child_process');
    const home = tmp();
    const cfg = path.join(home, 'config');
    fs.mkdirSync(cfg);
    fs.cpSync(path.join(__dirname, '..', '.claude', 'hooks'), path.join(cfg, 'hooks'), { recursive: true });
    mergeAntigravityHooks(path.join(cfg, 'hooks.json'));
    const command = JSON.parse(fs.readFileSync(path.join(cfg, 'hooks.json'), 'utf8'))['aos-go-gate'].PreToolUse[0].hooks[0].command;
    const fire = (CommandLine) => {
        const r = spawnSync('sh', ['-c', command], { cwd: cfg, encoding: 'utf8', input: JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine } }, conversationId: 'c1', stepIdx: 1, transcriptPath: path.join(home, 'none.jsonl'), workspacePaths: [home] }), env: { ...process.env, HOME: home, USERPROFILE: home } });
        assert.strictEqual(r.status, 0, r.stderr);
        return JSON.parse(r.stdout);
    };
    assert.strictEqual(fire(['git', 'push', 'origin', 'main'].join(' ')).decision, 'deny');
    assert.strictEqual(fire('ls').decision, 'allow');
});
