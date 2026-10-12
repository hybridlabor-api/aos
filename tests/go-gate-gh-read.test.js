// Read-only gh calls with jq filters were "unscoped" (a fresh GO each time): the quoted
// filter stayed command text and the segment split read `.[]|.x[0:8]` as a new command.
// Offline; the gate only classifies these strings, nothing here executes them.
const { test, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const GATE = path.resolve(__dirname, '..', '.claude', 'hooks', 'go-gate.mjs');
let g;
before(async () => { g = await import(pathToFileURL(GATE).href); g.setGateContext({ cwd: process.cwd(), blockTs: 0 }); });

const FREE = [
    "gh run list --json headSha -q '.[]|.headSha[0:8]'",
    "gh run list -R hybridlabor-api/aos --workflow release-please.yml --limit 2 --json status,conclusion,headSha -q '.[]|.status+\" \"+.conclusion+\" \"+.headSha[0:8]'",
    "gh run view 38112147114 -R hybridlabor-api/aos --json conclusion,jobs -q '.conclusion, (.jobs[]|.name+\" \"+([.steps[]|select(.conclusion!=\"success\")|.name]|join(\",\")))'",
    "gh pr list --repo=o/r --json number -q '.[]|\"#\\(.number)\"'",
    "gh pr view 143 --json files -q '.files[]|.path'",
    "gh pr checks 142 -R o/r",
    "gh search prs 'is:open label:x|y[1]'",
    "gh --version",
];
const GUARDED = [
    "gh pr view 1 \"$(git push origin main)\"",
    "gh pr list -q '.[]' ; git push origin main",
    "gh pr merge 142 -R o/r",
    "gh pr create --title 'a|b[0:8]' --body x",
    "gh release create v1 --notes 'x|y[0]'",
    "gh api repos/o/r/pulls -X POST -f title='a|b[0]'",
];

test('read-only gh calls with jq filters are free', () => {
    for (const c of FREE) assert.deepEqual(g.commandScopes(c), [], c);
});

test('writes and command substitutions stay guarded', () => {
    for (const c of GUARDED) assert.ok(g.isGuardedCommand(c), c);
});

test('aos-uninstall needs a plain GO unless it is a dry run', () => {
    for (const c of ['aos-uninstall', 'aos-uninstall --purge --yes', 'npx -p @hybridlabor-api/aos aos-uninstall --yes', 'node ~/.agents/bin/aos-uninstall.mjs', '~/.local/bin/aos-uninstall --yes'])
        assert.equal(g.commandScopes(c), null, c);
    for (const c of ['aos-uninstall --dry-run', 'npx -p @hybridlabor-api/aos aos-uninstall --dry-run', 'grep -n aos-uninstall README.md'])
        assert.deepEqual(g.commandScopes(c), [], c);
});

test('Codex exec_command input (tool_input.cmd) reaches the gate and is blocked', () => {
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, [GATE], { input: JSON.stringify({ tool_name: 'exec_command', tool_input: { cmd: 'git push origin main' } }), encoding: 'utf8', env: { ...process.env, AOS_TEST_SANDBOX: '1' } });
    assert.equal(r.status, 2, r.stderr);
});

const CODEX_PAYLOAD = (command) => ({ session_id: 's', turn_id: 't', transcript_path: 'C:\\Users\\x\\.codex\\sessions\\rollout-1.jsonl', cwd: process.cwd(), hook_event_name: 'PreToolUse', model: 'm', permission_mode: 'bypassPermissions', tool_name: 'Bash', tool_input: { command }, tool_use_id: 'exec-1' });

test('isCodexPayload needs turn_id plus a .codex transcript or a permission_mode string', () => {
    assert.equal(g.isCodexPayload(CODEX_PAYLOAD('x')), true);
    assert.equal(g.isCodexPayload({ turn_id: 't', permission_mode: 'default' }), true);
    assert.equal(g.isCodexPayload({ turn_id: 't', transcript_path: '/h/.claude/p.jsonl' }), false);
    assert.equal(g.isCodexPayload({ transcript_path: '/h/.codex/s.jsonl', permission_mode: 'x' }), false);
    assert.equal(g.isCodexPayload(null), false);
});

test('Codex payload: deny is exactly the hookSpecificOutput JSON, stderr and exit 2; allow prints nothing', () => {
    const d = runGate(CODEX_PAYLOAD('git push origin main'));
    assert.equal(d.status, 2);
    const out = JSON.parse(d.stdout);
    assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
    assert.deepEqual(Object.keys(out.hookSpecificOutput).sort(), ['hookEventName', 'permissionDecision', 'permissionDecisionReason']);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(out.hookSpecificOutput.permissionDecisionReason.length > 0);
    assert.equal(d.stderr.trim(), out.hookSpecificOutput.permissionDecisionReason);
    const a = runGate(CODEX_PAYLOAD('git status'));
    assert.equal(a.status, 0);
    assert.equal(a.stdout, '');
});

test('non-Codex payload keeps the Claude output: empty stdout, stderr, exit 2', () => {
    const r = runGate({ tool_name: 'Bash', tool_input: { command: 'git push origin main' } });
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /Blocked by go-gate hook/);
});

test('AOS_GATE_DEBUG appends one decision line per exit', () => {
    const fs = require('fs'), os = require('os');
    const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gate-dbg-')), 'gate.log');
    require('child_process').spawnSync(process.execPath, [GATE], { input: JSON.stringify(CODEX_PAYLOAD('git push origin main')), encoding: 'utf8', env: { ...process.env, AOS_TEST_SANDBOX: '1', AOS_GATE_DEBUG: log } });
    const rec = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((x) => x.decision);
    assert.equal(rec.decision, 'deny');
    assert.equal(rec.exit, 2);
    assert.equal(rec.tool_name, 'Bash');
    assert.ok(rec.reason);
});

const CODEX_JS ='const r = await tools.exec_command({cmd:"git push C:\\\\x\\\\target.git main",workdir:"C:\\\\x\\\\repo"}); text(r.output);';
const runGate = (payload) => require('child_process').spawnSync(process.execPath, [GATE], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, AOS_TEST_SANDBOX: '1' } });

test('Codex code mode (tool exec, JS source) is blocked like Bash', () => {
    for (const tool_input of [CODEX_JS, { code: CODEX_JS }, { input: CODEX_JS }, { source: CODEX_JS },
        'await tools.exec_command({cmd:"git status"}); await tools.exec_command({cmd: ["git", "push", "origin", "main"]});',
        'const c = "x"; tools.exec_command({cmd: c})']) {
        const r = runGate({ tool_name: 'exec', tool_input });
        assert.equal(r.status, 2, `${JSON.stringify(tool_input)} ${r.stderr}`);
    }
});

test('codexExecCommands reads literal cmd values and fails closed on anything else', () => {
    assert.deepEqual(g.codexExecCommands(CODEX_JS), { cmds: ['git push C:\\x\\target.git main'], opaque: false });
    assert.deepEqual(g.codexExecCommands("tools.exec_command({ workdir: 'x', cmd: 'a\\'b\\n\\u0041\\t' })"), { cmds: ["a'b\nA\t"], opaque: false });
    assert.deepEqual(g.codexExecCommands('tools.exec_command({cmd: `git status`})'), { cmds: ['git status'], opaque: false });
    const h = g.codexExecCommands('tools.exec_command({cmd:"git status"})');
    assert.deepEqual(h, { cmds: ['git status'], opaque: false });
    assert.deepEqual(g.commandScopes(h.cmds.join('\n')), []);
    for (const src of ['const c = "x"; tools.exec_command({cmd: c})', 'tools.exec_command({cmd: `git ${x}`})', 'tools.exec_command({cmd: "git " + x})',
        'tools.exec_command({workdir: "x"})', 'tools.exec_command({cmd})', 'tools.exec_command({...o})', 'tools.exec_command(o)',
        'const f = tools.exec_command; f({cmd: "git push"})', 'tools["exec_command"]({cmd: "git push"})', 'tools.exec_command({["cmd"]: "git push"})'])
        assert.equal(g.codexExecCommands(src).opaque, true, src);
});

test('PowerShell and cmd wrappers are opened like bash -c (Codex on Windows, Lenovo P15)', () => {
    const PS = '"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"';
    for (const c of [`${PS} -NoProfile -Command "git push C:\\x\\y.git main"`, 'powershell.exe -Command "git push origin main"', 'pwsh -NoProfile -ExecutionPolicy Bypass -c "npm publish"', 'cmd /c "git push origin main"', 'cmd.exe /C git push origin main'])
        assert.ok(g.isGuardedCommand(c), c);
    assert.equal(g.commandScopes(`${PS} -NoProfile -EncodedCommand ZwBpAHQAIABwAHUAcwBoAA==`), null);
    // Known over-block (safe side): a jq pipe inside the wrapper body still needs a GO, as with bash -c.
    for (const c of [`${PS} -NoProfile -Command "git status"`, 'powershell.exe -Command "gh pr view 1"', 'cmd /c dir'])
        assert.deepEqual(g.commandScopes(c), [], c);
});

test('Windows spellings classify like their POSIX twins (Lenovo P15 findings)', () => {
    assert.deepEqual(g.commandScopes('gh.exe pr merge 1'), ['merge']);
    assert.deepEqual(g.commandScopes('GH.EXE pr merge 1'), ['merge']);
    assert.ok(g.isGuardedCommand('gh.exe pr create --title x --body y'));
    assert.ok(g.isGuardedCommand('gh.exe release create v1'));
    assert.ok(g.isGuardedCommand('git.exe push origin main'));
    assert.deepEqual(g.commandScopes("gh.exe pr list -q '.[]|.x[0:8]'"), []);
    for (const c of ['C:\\Users\\x\\.local\\bin\\aos-uninstall.cmd --yes', '"C:\\Users\\x\\.local\\bin\\aos-uninstall.cmd" --yes', '& "C:\\Users\\x\\.local\\bin\\aos-uninstall.cmd" --yes', 'aos-uninstall.ps1 --yes'])
        assert.equal(g.commandScopes(c), null, c);
    assert.deepEqual(g.commandScopes('C:\\Users\\x\\.local\\bin\\aos-uninstall.cmd --dry-run'), []);
    const W = 'C:\\Users\\x\\.aos\\gate\\s.json';
    for (const c of [`del ${W}`, `echo x > ${W}`, `Set-Content ${W} x`, `tail ${W} | tee ${W}`, `tail ${W} | sort -o ${W}`])
        assert.ok(g.gateStoreReason(c), c);
    for (const c of [`tail -40 ${W} | cut -c1-200`, `cat ${W}`, `type ${W} | sort`, `Get-Content ${W} | sort`])
        assert.equal(g.gateStoreReason(c), null, c);
});

test('regressions: --dry-run=false is not a dry run; inline spawn of a non-literal command needs a GO', () => {
    assert.equal(g.commandScopes('aos-uninstall --dry-run=false'), null);
    assert.equal(g.commandScopes(`node -e "require('child_process').execSync(process.argv[1])" "git push origin main"`), null);
    assert.equal(g.commandScopes(`node -e "const {execSync}=require('child_process'); execSync(cmd)"`), null);
    assert.deepEqual(g.commandScopes(`node -e "require('child_process').execSync('git status')"`), []);
    assert.deepEqual(g.commandScopes(`node -e "console.log(require('fs').readFileSync('x','utf8'))"`), []);
});

test('store logs can be read through pure stdin filters; writes stay blocked', () => {
    const LOG = '/Users/x/.aos/gate/s.log';
    for (const c of [`tail -40 ${LOG} | cut -c1-260`, `cat ${LOG} | sort | uniq -c`, `grep -c deny ${LOG} | tr -d ' '`, 'ls -la ~/.aos/gate/ | head -20'])
        assert.equal(g.gateStoreReason(c), null, c);
    for (const c of [`cat ${LOG} | sort -o ${LOG}`, `cat ${LOG} | uniq - ${LOG}`, `tail ${LOG} | tee ${LOG}`, `tail ${LOG} | sed -i d ${LOG}`, `tail ${LOG} | sh`])
        assert.ok(g.gateStoreReason(c), c);
});
