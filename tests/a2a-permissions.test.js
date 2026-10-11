const { test, describe } = require('node:test');
const assert = require('node:assert');
const { pathToFileURL } = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const BIN = path.join(REPO, 'bin', 'aos-acp.mjs');
const LIB = path.join(REPO, 'lib', 'a2a-permissions.mjs');

const writeTool = (p) => ({ toolCallId: 't1', title: 'edit', kind: 'edit', locations: [{ path: p }] });
const execTool = (cmd, cwd) => ({ toolCallId: 't2', title: 'run ' + cmd, kind: 'execute', rawInput: cwd ? { command: cmd, cwd } : { command: cmd } });
const OPTIONS = [{ optionId: 'yes-once', name: 'Allow', kind: 'allow_once' }, { optionId: 'no-once', name: 'Reject', kind: 'reject_once' }];

const jsonl = (...e) => e.map((x) => JSON.stringify(x)).join('\n') + '\n';
const masterTranscript = (name) => {
    const p = path.join(home, 'master.jsonl');
    fs.writeFileSync(p, jsonl({ type: 'agent-name', agentName: 'master' }, { type: 'user', uuid: `u-${name}`, message: { role: 'user', content: `GO ${name}` } }));
    return p;
};
// The existing test seam: a token under TEST HOME (never ~/.aos/go of the real user).
const tokenPath = (name) => path.join(home, '.aos', 'go', `${name}.token`);
const writeToken = (name) => {
    fs.mkdirSync(path.dirname(tokenPath(name)), { recursive: true });
    fs.writeFileSync(tokenPath(name), JSON.stringify({ target: name, issued_at: new Date().toISOString(), master_transcript: masterTranscript(name) }));
};

let home, work, outside;
test('setup worktree, outside directory and test HOME', () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-perm-home-'));
    process.env.HOME = home;
    process.env.USERPROFILE = home; // Windows os.homedir() reads USERPROFILE, not HOME
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-perm-work-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-perm-out-'));
});

describe('decide: scoped file writes', () => {
    test('target inside the worktree is allowed', async () => {
        const mod = await import(`file://${LIB}`);
        fs.writeFileSync(path.join(work, 'existing.txt'), 'x');
        assert.equal(mod.decide(writeTool('existing.txt'), { cwd: work }).allow, true);
        assert.equal(mod.decide(writeTool(path.join(work, 'nope.txt')), { cwd: work }).allow, true);
    });

    test('target outside the worktree is denied', async () => {
        const mod = await import(`file://${LIB}`);
        const d = mod.decide(writeTool(path.join(outside, 'evil.txt')), { cwd: work });
        assert.equal(d.allow, false);
        assert.match(d.reason, /outside the job worktree/);
    });

    test('symlink escape is denied', async () => {
        const mod = await import(`file://${LIB}`);
        fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
        fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(work, 'leak.txt'));
        const d = mod.decide(writeTool('leak.txt'), { cwd: work });
        assert.equal(d.allow, false);
        assert.match(d.reason, /outside the job worktree/);
        fs.symlinkSync(outside, path.join(work, 'dir-leak'));
        assert.equal(mod.decide(writeTool(path.join(work, 'dir-leak', 'new.txt')), { cwd: work }).allow, false);
    });

    test('`..` escape is denied', async () => {
        const mod = await import(`file://${LIB}`);
        const d = mod.decide(writeTool(path.join(work, '..', 'up-and-out.txt')), { cwd: work });
        assert.equal(d.allow, false);
        assert.match(d.reason, /outside the job worktree/);
        assert.equal(mod.decide(writeTool('../deep/../quest.txt'), { cwd: work }).allow, false);
    });

    test('nonexistent targets resolve through their existing parent', async () => {
        const mod = await import(`file://${LIB}`);
        fs.mkdirSync(path.join(work, 'sub'));
        assert.equal(mod.decide(writeTool(path.join(work, 'sub', 'deep', 'new.txt')), { cwd: work }).allow, true);
    });
});

describe('decide: scoped shell commands', () => {
    test('unguarded command with cwd inside the worktree is allowed', async () => {
        const mod = await import(`file://${LIB}`);
        assert.equal(mod.decide(execTool('ls -la'), { cwd: work }).allow, true);
    });

    test('shell cwd outside the worktree is denied', async () => {
        const mod = await import(`file://${LIB}`);
        const d = mod.decide(execTool('ls', outside), { cwd: work });
        assert.equal(d.allow, false);
        assert.match(d.reason, /outside the job worktree/);
    });

    test('guarded commands come back for the GO path, hard blocks are denied outright', async () => {
        const mod = await import(`file://${LIB}`);
        const g = mod.decide(execTool('git push origin main'), { cwd: work });
        assert.equal(g.allow, false);
        assert.equal(g.guarded, true);
        const h = mod.decide(execTool('rm -rf /'), { cwd: work });
        assert.equal(h.allow, false);
        assert.equal(h.guarded, undefined);
        assert.match(h.reason, /HARD BLOCK/);
    });
});

describe('aos-acp with --allow-default scoped', () => {
    const run = async (toolCall, over = {}) => {
        const mod = await import(`file://${BIN}`);
        return mod.decidePermission({ toolCall, options: OPTIONS }, { name: 'w1', cwd: work, goWait: 0, consume: false, allowDefault: 'scoped', ...over });
    };

    test('guarded command still takes the GO path: approved via the token seam and consumed', async () => {
        writeToken('w1');
        const ok = await run(execTool('git push origin main'), { consume: true });
        assert.equal(ok.outcome.optionId, 'yes-once');
        assert.equal(fs.existsSync(tokenPath('w1')), false, 'token consumed exactly like the old path');
    });

    test('guarded command without a token rejects with the GO reason', async () => {
        const r = await run(execTool('git push origin main'));
        assert.equal(r.outcome.optionId, 'no-once');
    });

    test('unguarded command inside the worktree allows, outside scope denies', async () => {
        assert.equal((await run(execTool('ls -la'))).outcome.optionId, 'yes-once');
        assert.equal((await run(execTool('ls', outside))).outcome.optionId, 'no-once');
        assert.equal((await run(writeTool(path.join(outside, 'x.txt')))).outcome.optionId, 'no-once');
    });
});

describe('--allow-default allow behaviour unchanged', () => {
    const run = async (toolCall, over = {}) => {
        const mod = await import(`file://${BIN}`);
        return mod.decidePermission({ toolCall, options: OPTIONS }, { name: 'w1', cwd: work, goWait: 0, consume: false, allowDefault: 'allow', ...over });
    };

    test('unguarded command allows without any path check', async () => {
        assert.equal((await run(execTool('ls'), { cwd: outside })).outcome.optionId, 'yes-once');
        assert.equal((await run(writeTool(path.join(outside, 'x.txt')), { cwd: outside })).outcome.optionId, 'yes-once');
    });

    test('deny default and unknown scoped value are refused by parseArgs', async () => {
        const { parseArgs } = await import(`file://${BIN}`);
        assert.equal(parseArgs(['codex', '--name', 'w', '--prompt', 'x', '--allow-default', 'scoped']).allowDefault, 'scoped');
        assert.throws(() => parseArgs(['codex', '--name', 'w', '--prompt', 'x', '--allow-default', 'sometimes']), /deny, allow or scoped/);
    });
});

describe('S5-4: network writes from a worker shell are guarded', () => {
    test('curl/wget/http writes need a GO; a plain GET and a local command still pass', async () => {
        const { networkWrite, decide } = await import(pathToFileURL(LIB).href);
        for (const c of ['curl -X POST https://x.test', 'curl -d a=b https://x.test', 'curl -o ~/.bashrc https://x.test', 'wget -O f https://x.test', 'http POST x.test']) {
            assert.equal(networkWrite(c), true, c);
            assert.equal(decide(execTool(c), { cwd: os.tmpdir() }).guarded, true, c);
        }
        assert.equal(networkWrite('curl -sSL https://x.test'), false);
        assert.equal(decide(execTool('ls -la', os.tmpdir()), { cwd: os.tmpdir() }).allow, true);
        assert.equal(decide(writeTool('/etc/hosts'), { cwd: os.tmpdir() }).allow, false, 'a file write outside the worktree stays denied');
    });
});
