const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const BIN = path.join(REPO, 'bin', 'aos-acp.mjs');
const FAKE = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(__dirname, 'fixtures', 'fake-acp-agent.mjs'))}`;

let home;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-acp-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const jsonl = (...e) => e.map((x) => JSON.stringify(x)).join('\n') + '\n';
const masterTranscript = (name) => {
    const p = path.join(home, 'master.jsonl');
    fs.writeFileSync(p, jsonl({ type: 'agent-name', agentName: 'master' }, { type: 'user', uuid: `u-${name}`, message: { role: 'user', content: `GO ${name}` } }));
    return p;
};
const tokenPath = (name) => path.join(home, '.aos', 'go', `${name}.token`);
const writeToken = (name, over = {}) => {
    fs.mkdirSync(path.dirname(tokenPath(name)), { recursive: true });
    fs.writeFileSync(tokenPath(name), JSON.stringify({ target: name, issued_at: new Date().toISOString(), master_transcript: masterTranscript(name), ...over }));
};
const readLog = (name) => fs.readFileSync(path.join(home, '.aos', 'acp', `${name}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const run = (args, env = {}) => spawnSync(process.execPath, [BIN, 'codex', '--cmd', FAKE, '--cwd', home, ...args], {
    env: { ...process.env, HOME: home, ...env }, encoding: 'utf8', timeout: 20000,
});

describe('aos-acp with a fake ACP agent', () => {
    test('handshake, prompt streaming, run log', () => {
        const r = run(['--name', 'w1', '--prompt', 'hi']);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout, 'hello world\n');
        const events = readLog('w1').map((e) => e.event);
        for (const ev of ['start', 'initialized', 'session', 'text', 'done']) assert.ok(events.includes(ev), `log lacks ${ev}: ${events}`);
        const sent = readLog('w1').filter((e) => e.event === 'send').map((e) => e.params);
        assert.equal(sent[0].protocolVersion, 1);
        assert.equal(sent[1].cwd, home);
        assert.deepEqual(sent[2].prompt, [{ type: 'text', text: 'hi' }]);
    });

    test('guarded command denied without token', () => {
        const r = run(['--name', 'w1', '--prompt', 'push'], { FAKE_CMD: 'git push origin main' });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /decision=no-once/);
        const p = readLog('w1').find((e) => e.event === 'permission');
        assert.equal(p.guarded, true);
        assert.equal(p.allow, false);
        assert.match(p.reason, /no GO token/);
    });

    test('guarded command approved with token, token consumed', () => {
        writeToken('w1');
        const r = run(['--name', 'w1', '--prompt', 'push'], { FAKE_CMD: 'git push origin main' });
        assert.match(r.stdout, /decision=yes-once/);
        assert.equal(fs.existsSync(tokenPath('w1')), false, 'token must be single use');
        assert.equal(readLog('w1').find((e) => e.event === 'permission').reason, 'GO token');
    });

    test('--no-consume approves but leaves the token for the inner gate', () => {
        writeToken('w1');
        const r = run(['--name', 'w1', '--prompt', 'push', '--no-consume'], { FAKE_CMD: 'git push origin main' });
        assert.match(r.stdout, /decision=yes-once/);
        assert.ok(fs.existsSync(tokenPath('w1')));
    });

    test('token for another worker, expired token, stale master transcript: denied', () => {
        writeToken('w2');
        assert.match(run(['--name', 'w1', '--prompt', 'x'], { FAKE_CMD: 'npm publish' }).stdout, /decision=no-once/);
        writeToken('w1', { issued_at: new Date(Date.now() - 11 * 60000).toISOString() });
        assert.match(run(['--name', 'w1', '--prompt', 'x'], { FAKE_CMD: 'npm publish' }).stdout, /decision=no-once/);
        writeToken('w1');
        fs.appendFileSync(path.join(home, 'master.jsonl'), jsonl({ type: 'user', message: { role: 'user', content: 'wait' } }));
        assert.match(run(['--name', 'w1', '--prompt', 'x'], { FAKE_CMD: 'npm publish' }).stdout, /decision=no-once/);
        assert.ok(fs.existsSync(tokenPath('w1')), 'a rejected token is not consumed');
    });

    test('unguarded command follows --allow-default (deny by default)', () => {
        assert.match(run(['--name', 'w1', '--prompt', 'ls'], { FAKE_CMD: 'ls -la' }).stdout, /decision=no-once/);
        assert.match(run(['--name', 'w1', '--prompt', 'ls', '--allow-default', 'allow'], { FAKE_CMD: 'ls -la' }).stdout, /decision=yes-once/);
        assert.equal(readLog('w1').filter((e) => e.event === 'permission').every((e) => e.guarded === false), true);
    });

    test('--go-wait parks the request until the token appears', async () => {
        const { spawn } = require('child_process');
        const child = spawn(process.execPath, [BIN, 'codex', '--cmd', FAKE, '--cwd', home, '--name', 'w1', '--prompt', 'push', '--go-wait', '10'],
            { env: { ...process.env, HOME: home, FAKE_CMD: 'git push' } });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        await new Promise((r) => setTimeout(r, 1500));
        assert.ok(fs.existsSync(path.join(home, '.aos', 'acp', 'w1.jsonl')) && readLog('w1').some((e) => e.event === 'permission_pending'));
        writeToken('w1');
        const code = await new Promise((r) => child.on('exit', r));
        assert.equal(code, 0);
        assert.match(out, /decision=yes-once/);
    });

    test('agy adapter is refused with a pointer to mcsc; unknown adapter errors', () => {
        const r = spawnSync(process.execPath, [BIN, 'agy', '--name', 'a', '--prompt', 'x'], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
        assert.equal(r.status, 2);
        assert.match(r.stderr, /mcsc/);
        assert.equal(spawnSync(process.execPath, [BIN, 'nope', '--name', 'a', '--prompt', 'x'], { env: { ...process.env, HOME: home }, encoding: 'utf8' }).status, 2);
    });

    test('guard list is the go-gate list', async () => {
        const mod = await import(`file://${BIN}`);
        for (const c of ['git push', 'npm publish', 'npm version patch', 'gh pr merge 1', 'gh release create v1', 'git reset --hard', 'git clean -df', 'rm -rf x']) assert.ok(mod.isGuarded(c), c);
        for (const c of ['git status', 'npm test', 'rm x']) assert.ok(!mod.isGuarded(c), c);
        assert.equal(mod.commandOf({ rawInput: { command: ['git', 'push'] } }), 'git push');
    });
});
