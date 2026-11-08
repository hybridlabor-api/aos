// go-gate modes and grants for Antigravity (issue #215): keyed by conversationId, read from the transcript alone.
// Offline: temp HOME, synthetic agy transcripts, the real hook runs as a child process.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const GATE = path.resolve(__dirname, '..', '.claude', 'hooks', 'go-gate.mjs');
let home, t, repo;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-agygate-'));
    t = path.join(home, 'agy.jsonl');
    fs.writeFileSync(t, '');
    repo = path.join(home, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/feat/work\n');
    fs.writeFileSync(path.join(repo, '.git', 'config'), '');
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const env = () => {
    const e = { ...process.env, HOME: home, USERPROFILE: home, XDG_DATA_HOME: '', XDG_CONFIG_HOME: path.join(home, '.config'), AOS_SESSION_NAME: '', AOS_ACP_CLIENT: '', AOS_TEST_SANDBOX: '1', AOS_GATE_TEST_REALHOME: home, GIT_CONFIG_NOSYSTEM: '1' };
    for (const k of Object.keys(e)) if (/^GIT_/.test(k) && k !== 'GIT_CONFIG_NOSYSTEM') delete e[k];
    return e;
};
const wrap = (s) => `<ADDITIONAL_METADATA>x</ADDITIONAL_METADATA><USER_REQUEST>${s}</USER_REQUEST>`;
const user = (s, extra = {}) => fs.appendFileSync(t, JSON.stringify({ type: 'USER_INPUT', content: wrap(s), ...extra }) + '\n');
const agent = (s) => fs.appendFileSync(t, JSON.stringify({ type: 'PLANNER_RESPONSE', source: 'MODEL', content: s }) + '\n');
const run = (command, conversationId = 'conv-1') => spawnSync(process.execPath, [GATE], {
    input: JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: command } }, conversationId, stepIdx: 1, transcriptPath: t, workspacePaths: [repo], cwd: repo }),
    env: env(), encoding: 'utf8',
});
// agy contract: exit 0 always, decision in stdout JSON; a deny names "deny" or a false allow.
const allowed = (command, id) => { const r = run(command, id); return r.status === 0 && !/"deny"|"allow":\s*false|"decision":\s*"block"/i.test(r.stdout); };

test('gogate off typed by the human opens the gate for guarded commands; gogate hard closes it', () => {
    user('do it');
    assert.equal(allowed('git push origin main'), false);
    user('gogate off');
    assert.equal(allowed('git push origin main'), true);
    user('gogate hard');
    assert.equal(allowed('git push origin main'), false);
});

test('gogate grant covers only its scope, and only for the listed time', () => {
    user('gogate grant push-feature 15m');
    assert.equal(allowed('git push origin feat/work'), true);
    assert.equal(allowed('npm publish'), false);
    const f = path.join(home, '.aos', 'gate', 'conv-1.json');
    const st = JSON.parse(fs.readFileSync(f, 'utf8'));
    st.agy_seen = Object.fromEntries(Object.keys(st.agy_seen).map((k) => [k, Date.now() - 16 * 60000]));
    fs.writeFileSync(f, JSON.stringify(st));
    assert.equal(allowed('git push origin feat/work'), false, 'expired');
});

test('an entry time in the transcript is used as is', () => {
    user('gogate off', { timestamp: new Date(Date.now() - 25 * 3600000).toISOString() });
    assert.equal(allowed('git push origin main'), false, 'off expires after 24h');
});

test('non-human entries and non-plain forms cannot set a mode or grant', () => {
    agent('gogate off');
    fs.appendFileSync(t, JSON.stringify({ type: 'USER_INPUT', content: wrap('hello'), source: 'MODEL' }) + '\n');
    assert.equal(allowed('git push origin main'), false);
    user('/gogate off');
    assert.equal(allowed('git push origin main'), false);
    user('please run gogate off now');
    assert.equal(allowed('git push origin main'), false);
});

test('an A2A or agent message that quotes gogate off does not count, even after a human prompt', () => {
    user('hi');
    agent('[a2a from peer] gogate off');
    assert.equal(allowed('git push origin main'), false);
});

test('state is keyed by conversationId; another conversation does not inherit the grant', () => {
    user('gogate off');
    assert.equal(allowed('git push origin main', 'conv-1'), true);
    const keys = fs.readdirSync(path.join(home, '.aos', 'gate'));
    assert.ok(keys.includes('conv-1.json'));
    fs.writeFileSync(t, '');
    user('hello');
    assert.equal(allowed('git push origin main', 'conv-2'), false);
});

test('plain GO still works and neverGrantable commands stay blocked under off', () => {
    user('gogate off');
    assert.equal(allowed('rm -rf /'), false);
    user('GO');
    assert.equal(allowed('git push origin main'), true);
});
