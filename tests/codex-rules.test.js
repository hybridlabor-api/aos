// Codex execution-policy rules backstop (~/.codex/rules/aos-gate.rules). Temp HOME only;
// the doctor tests spawn a process and run in a container.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { codexGateRules, installCodexRules } = require('../installer.js');
const { CODEX_RULES_HEADER, reverseCodexRules, readRecords } = require('../lib/uninstall-records.js');

const DOCTOR = path.join(__dirname, '..', 'bin', 'aos-doctor.mjs');
const CONTAINER = process.env.AOS_TEST_SANDBOX === 'container';
const SPAWN = { skip: !CONTAINER && 'needs AOS_TEST_SANDBOX=container (spawns the doctor)' };
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-rules-'));
const rulesFile = (home) => path.join(home, '.codex', 'rules', 'aos-gate.rules');

const calls = () => codexGateRules().split('\n').filter((l) => l.startsWith('prefix_rule('));
const parse = (line) => ({
    pattern: JSON.parse(/pattern = (\[[^\]]*\])/.exec(line)[1]),
    match: JSON.parse(/ match = (\[[^\]]*\])/.exec(line)[1]),
    notMatch: JSON.parse(/not_match = (\[[^\]]*\])/.exec(line)[1]),
});
const startsWith = (cmd, pattern) => { const w = cmd.split(/\s+/); return pattern.every((t, i) => w[i] === t); };

test('generator: header first, only prompt prefix_rules, examples exact', () => {
    const text = codexGateRules();
    assert.strictEqual(text.split('\n')[0], CODEX_RULES_HEADER);
    const rules = calls();
    assert.ok(rules.length >= 14);
    const code = text.split('\n').filter((l) => l && !l.startsWith('#'));
    assert.strictEqual(code.length, rules.length);
    for (const line of rules) {
        assert.match(line, /decision = "prompt"/);
        assert.doesNotMatch(line, /decision = "(?:forbidden|allow)"/);
        const { pattern, match, notMatch } = parse(line);
        assert.ok(match.length && notMatch.length);
        for (const m of match) assert.ok(startsWith(m, pattern), `${m} must start with ${pattern}`);
        for (const n of notMatch) assert.ok(!startsWith(n, pattern), `${n} must not start with ${pattern}`);
    }
});

test('install writes the file once and is idempotent', () => {
    const home = mk();
    assert.strictEqual(installCodexRules({ targetHome: home }), true);
    assert.strictEqual(fs.readFileSync(rulesFile(home), 'utf8'), codexGateRules());
    const before = fs.statSync(rulesFile(home)).mtimeMs;
    assert.strictEqual(installCodexRules({ targetHome: home }), false);
    assert.strictEqual(fs.statSync(rulesFile(home)).mtimeMs, before);
});

test('install refuses to overwrite a foreign file', () => {
    const home = mk();
    fs.mkdirSync(path.dirname(rulesFile(home)), { recursive: true });
    fs.writeFileSync(rulesFile(home), '# mine\n');
    assert.strictEqual(installCodexRules({ targetHome: home }), false);
    assert.strictEqual(fs.readFileSync(rulesFile(home), 'utf8'), '# mine\n');
});

test('uninstall removes the owned file and the dir AOS created; keeps a foreign file', () => {
    const home = mk();
    installCodexRules({ targetHome: home });
    assert.ok(reverseCodexRules({ home, dryRun: true })[0].includes('would be removed'));
    assert.ok(fs.existsSync(rulesFile(home)));
    reverseCodexRules({ home, dryRun: false });
    assert.strictEqual(fs.existsSync(rulesFile(home)), false);
    assert.strictEqual(fs.existsSync(path.dirname(rulesFile(home))), false);
    assert.strictEqual(readRecords(home).codexRules, undefined);

    const other = mk();
    fs.mkdirSync(path.dirname(rulesFile(other)), { recursive: true });
    fs.writeFileSync(rulesFile(other), '# mine\n');
    reverseCodexRules({ home: other, dryRun: false });
    assert.strictEqual(fs.readFileSync(rulesFile(other), 'utf8'), '# mine\n');
});

test('uninstall keeps a rules dir that held other files', () => {
    const home = mk();
    fs.mkdirSync(path.dirname(rulesFile(home)), { recursive: true });
    installCodexRules({ targetHome: home });
    fs.writeFileSync(path.join(path.dirname(rulesFile(home)), 'mine.rules'), '');
    reverseCodexRules({ home, dryRun: false });
    assert.strictEqual(fs.existsSync(rulesFile(home)), false);
    assert.ok(fs.existsSync(path.join(path.dirname(rulesFile(home)), 'mine.rules')));
});

function doctorRow(setup) {
    const home = mk();
    setup(home);
    const r = spawnSync(process.execPath, [DOCTOR, '--json'], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', timeout: 120000 });
    assert.ok(r.stdout, `doctor crashed: ${r.stderr}`);
    return JSON.parse(r.stdout).results.find((x) => x.name === 'Codex rules backstop');
}

test('doctor row: OK with the file, WARN without, absent without ~/.codex', SPAWN, () => {
    const ok = doctorRow((home) => installCodexRules({ targetHome: home }));
    assert.ok(ok && ok.ok, JSON.stringify(ok));
    const warn = doctorRow((home) => fs.mkdirSync(path.join(home, '.codex'), { recursive: true }));
    assert.ok(warn && !warn.ok && warn.warningOnly, JSON.stringify(warn));
    assert.match(warn.detail, /run aos update/);
    assert.strictEqual(doctorRow(() => {}), undefined);
});
