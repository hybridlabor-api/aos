// MCP secrets: no inline tokens in any harness config, one 0600 secrets file, a launcher that passes only
// declared variables, AOS-only overwrite, migration, doctor and uninstall. Fake tokens only; no test
// output may contain one (assertions use messages that never echo a value).
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-mcpsec-home-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;

const installer = require('../installer.js');
const sec = require('../lib/mcp-secrets.js');
const records = require('../lib/uninstall-records.js');

const ROOT = path.resolve(__dirname, '..');
const LAUNCHER = path.join(ROOT, 'bin', 'aos-mcp-env.mjs');
const DOCTOR = path.join(ROOT, 'bin', 'aos-doctor.mjs');
const GH_ARGS = ['-y', '@modelcontextprotocol/server-github@2025.4.8'];
const T = { gh: 'ghp_TESTONLYaaaa1111', gem: 'AIzaTESTONLYbbbb2222', stored: 'ghp_TESTONLYstored9999', other: 'sk-TESTONLYcccc3333' };

let n = 0;
const fresh = () => { const d = path.join(HOME, `case${++n}`); fs.mkdirSync(d, { recursive: true }); return d; };
const write = (p, text, mode) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text, mode ? { mode } : undefined); fs.chmodSync(p, mode || 0o644); return p; };
const json = (p, o) => write(p, JSON.stringify(o, null, 2));
const read = (p) => fs.readFileSync(p, 'utf8');
const mode = (p) => (process.platform === 'win32' ? 0o600 : fs.statSync(p).mode & 0o777); // Windows has no POSIX mode bits; the product skips these checks there
const noToken = (text, label) => { for (const v of Object.values(T)) assert.ok(!text.includes(v), `${label} must not contain a token value`); };
const baks = (file) => fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith(`${path.basename(file)}.`) && f.endsWith('.bak'));
const SECRETS = sec.secretsPath(HOME);

function quiet(fn) {
    let out = '';
    const o = process.stdout.write; const e = process.stderr.write;
    process.stdout.write = (c) => { out += c; return true; };
    process.stderr.write = (c) => { out += c; return true; };
    try { fn(); } finally { process.stdout.write = o; process.stderr.write = e; }
    return out;
}
const reset = () => { fs.mkdirSync(path.dirname(SECRETS), { recursive: true }); fs.writeFileSync(SECRETS, ''); fs.chmodSync(SECRETS, 0o600); };

const master = () => ({ mcpServers: {
    github: { command: 'npx', args: GH_ARGS, env: { GITHUB_PERSONAL_ACCESS_TOKEN: T.gh } },
    memb_mcp: { command: '__PYTHON_BIN__', args: ['__MCPS_DIR__/memb-mcp/run.py'], env: { GEMINI_API_KEY: T.gem } },
    deja: { command: 'deja', args: ['mcp'] },
} });

describe('writers never emit an inline secret', () => {
    test('JSON harness configs (Claude, Cursor, agy share one writer)', () => {
        const f = path.join(fresh(), 'mcp.json');
        quiet(() => installer.syncMcpConfigFile(f, master()));
        const text = read(f);
        noToken(text, 'JSON config');
        const s = JSON.parse(text).mcpServers;
        assert.equal(s.github.command, 'node');
        assert.match(s.github.args[0], /aos-mcp-env\.mjs$/);
        assert.deepEqual(s.github.args.slice(1, 3), ['--vars', 'GITHUB_PERSONAL_ACCESS_TOKEN']);
        assert.equal(s.github.env, undefined);
        assert.deepEqual(s.deja, { command: 'deja', args: ['mcp'] });
        assert.equal(mode(f), 0o600);
    });

    test('Codex config.toml', () => {
        const f = path.join(fresh(), 'config.toml');
        quiet(() => installer.mergeCodexTomlMcpServers(f, master().mcpServers));
        const text = read(f);
        noToken(text, 'config.toml');
        assert.ok(text.includes('"--vars", "GITHUB_PERSONAL_ACCESS_TOKEN"'));
        assert.ok(!/^env\s*=/m.test(text));
    });

    test('OpenCode opencode.json', () => {
        const f = path.join(fresh(), 'opencode.json');
        quiet(() => installer.syncOpencodeConfigFile(f, master()));
        const text = read(f);
        noToken(text, 'opencode.json');
        const gh = JSON.parse(text).mcp.github;
        assert.equal(gh.command[0], 'node');
        assert.equal(gh.environment, undefined);
    });

    test('secondary store mirror (~/.claude.json)', () => {
        const f = path.join(fresh(), '.claude.json');
        quiet(() => installer.mirrorMcpServersTo([f], JSON.stringify(master())));
        noToken(read(f), 'mirror');
        assert.match(JSON.parse(read(f)).mcpServers.memb_mcp.args[0], /aos-mcp-env\.mjs$/);
    });

    test('A2: the shipped remoteos entry never carries the placeholder gateway URL; the launcher reads it', () => {
        const entry = sec.shippedServers(ROOT).bdb_remoteos_mcp;
        assert.ok(!JSON.stringify(entry).includes('yourdomain'));
        const wrapped = sec.wrapServer('bdb_remoteos_mcp', entry, '/l/aos-mcp-env.mjs');
        assert.ok(sec.unwrap(wrapped).vars.includes('REMOTEOS_GATEWAY_URL'));
    });
});

describe('launcher', () => {
    const run = (home, vars, script, extra = {}) => spawnSync(process.execPath, [LAUNCHER, '--vars', vars, '--', process.execPath, '-e', script], {
        env: { HOME: home, USERPROFILE: home, PATH: process.env.PATH, ...extra }, encoding: 'utf8',
    });
    const probe = 'console.log(JSON.stringify(["A_TOK","B_TOK","C_TOK"].filter((k)=>process.env[k])))';

    test('passes only the declared variables', () => {
        const h = fresh();
        write(path.join(h, '.aos', 'secrets.env'), 'A_TOK=fake-a\nB_TOK=fake-b\nC_TOK=fake-c\n', 0o600);
        const r = run(h, 'A_TOK,B_TOK', probe);
        assert.equal(r.status, 0);
        assert.deepEqual(JSON.parse(r.stdout), ['A_TOK', 'B_TOK']);
        assert.ok(!r.stderr.includes('fake-'));
    });

    test('refuses a group/world-readable file but still starts the server', { skip: process.platform === 'win32' && 'mode bits do not exist on Windows (lib/mcp-secrets.js skips the check)' }, () => {
        const h = fresh();
        write(path.join(h, '.aos', 'secrets.env'), 'A_TOK=fake-a\n', 0o644);
        const r = run(h, 'A_TOK', probe);
        assert.equal(r.status, 0);
        assert.deepEqual(JSON.parse(r.stdout), []);
        assert.match(r.stderr, /must be 600/);
        assert.ok(!r.stderr.includes('fake-a'));
    });

    test('refuses a file that is not regular', () => {
        const h = fresh();
        fs.mkdirSync(path.join(h, '.aos', 'secrets.env'), { recursive: true });
        const r = run(h, 'A_TOK', probe);
        assert.deepEqual(JSON.parse(r.stdout), []);
        assert.match(r.stderr, /not a regular file/);
    });

    test('missing file: server starts without the variable and stderr says where to put it', () => {
        const h = fresh();
        const r = run(h, 'A_TOK', probe);
        assert.equal(r.status, 0);
        assert.deepEqual(JSON.parse(r.stdout), []);
        assert.match(r.stderr, /A_TOK not set; add it to .*secrets\.env/);
    });

    test('an already exported variable is kept and the exit code is forwarded', () => {
        const h = fresh();
        write(path.join(h, '.aos', 'secrets.env'), 'A_TOK=from-file\n', 0o600);
        const r = run(h, 'A_TOK', 'process.exit(process.env.A_TOK === "from-env" ? 7 : 1)', { A_TOK: 'from-env' });
        assert.equal(r.status, 7);
    });

    test('a missing command is reported, not hidden', () => {
        const h = fresh();
        const r = spawnSync(process.execPath, [LAUNCHER, '--vars', 'A_TOK', '--', 'aos-no-such-command-xyz'], { env: { HOME: h, PATH: process.env.PATH }, encoding: 'utf8' });
        assert.equal(r.status, 127);
        assert.match(r.stderr, /cannot start/);
    });
});

describe('ownership', () => {
    test('JSON: a same-named entry with another command stays untouched', () => {
        const f = json(path.join(fresh(), 'mcp.json'), { mcpServers: { github: { command: 'my-github', args: ['--x'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: T.other } } } });
        const before = read(f);
        const out = quiet(() => installer.syncMcpConfigFile(f, master()));
        const s = JSON.parse(read(f)).mcpServers;
        assert.equal(s.github.command, 'my-github');
        assert.equal(s.github.env.GITHUB_PERSONAL_ACCESS_TOKEN, T.other, 'user entry kept as is');
        assert.ok(s.memb_mcp, 'other AOS entries are still added');
        assert.ok(read(f) !== before);
        assert.match(out, /own "github" MCP entry/);
        noToken(out, 'log output');
    });

    test('Codex: a user table with the same name and another command stays', () => {
        const f = write(path.join(fresh(), 'config.toml'), '[mcp_servers.github]\ncommand = "my-github"\nargs = ["--x"]\n');
        let skipped;
        quiet(() => { skipped = installer.mergeCodexTomlMcpServers(f, master().mcpServers); });
        assert.deepEqual(skipped, ['github']);
        assert.ok(read(f).includes('command = "my-github"'));
    });

    test('OpenCode: a user entry with the same name stays', () => {
        const f = json(path.join(fresh(), 'opencode.json'), { mcp: { memb_mcp: { type: 'local', command: ['my-memb'], enabled: true, environment: { GEMINI_API_KEY: T.other } } } });
        quiet(() => installer.syncOpencodeConfigFile(f, master()));
        const e = JSON.parse(read(f)).mcp.memb_mcp;
        assert.deepEqual(e.command, ['my-memb']);
        assert.equal(e.environment.GEMINI_API_KEY, T.other);
    });

    test('isAosOwned needs the shipped name and the shipped command', () => {
        const shipped = sec.shippedServers(ROOT);
        assert.ok(sec.isAosOwned('github', { command: 'npx', args: GH_ARGS }, null, shipped));
        assert.ok(!sec.isAosOwned('github', { command: 'npx', args: ['-y', 'evil'] }, null, shipped));
        assert.ok(!sec.isAosOwned('mine', { command: 'npx', args: GH_ARGS }, null, shipped));
        assert.ok(sec.isAosOwned('bdb_unreal_mcp', { command: 'node', args: ['/x/mcps/unreal_mcp/dist/cli.js'] }, null, shipped));
    });
});

describe('migration of an existing install', () => {
    const seed = () => {
        const h = path.join(HOME, 'real');
        reset();
        return h;
    };

    test('Claude config: moves values, backs up first, is idempotent, keeps user entries', () => {
        seed();
        const f = json(path.join(HOME, '.claude.json'), { numStartups: 3, mcpServers: {
            github: { command: 'npx', args: GH_ARGS, env: { GITHUB_PERSONAL_ACCESS_TOKEN: T.gh, KEEP_ME: 'yes' } },
            memb_mcp: { command: '/h/.gemini/config/mcps/memb-mcp/.venv/bin/python', args: ['/h/.gemini/config/mcps/memb-mcp/run.py'], env: { GEMINI_API_KEY: T.gem } },
            mine: { command: 'mine', env: { SOME_TOKEN: T.other } },
        } });
        const original = read(f);
        const out = quiet(() => installer.migrateMcpSecrets());
        noToken(out, 'migration log');

        const after = read(f);
        noToken(after.replace(T.other, ''), 'migrated config');
        const s = JSON.parse(after);
        assert.equal(s.numStartups, 3);
        assert.deepEqual(s.mcpServers.github.args.slice(1, 3), ['--vars', 'GITHUB_PERSONAL_ACCESS_TOKEN']);
        assert.deepEqual(s.mcpServers.github.env, { KEEP_ME: 'yes' });
        assert.equal(s.mcpServers.memb_mcp.args[2], 'GEMINI_API_KEY');
        assert.equal(s.mcpServers.mine.env.SOME_TOKEN, T.other, 'user entry untouched');

        const stored = sec.parseEnvText(read(SECRETS));
        assert.equal(stored.GITHUB_PERSONAL_ACCESS_TOKEN, T.gh);
        assert.equal(stored.GEMINI_API_KEY, T.gem);
        assert.equal(mode(SECRETS), 0o600);

        const b = baks(f);
        assert.equal(b.length, 1, 'one backup');
        assert.equal(read(path.join(HOME, b[0])), original, 'backup holds the pre-migration content');
        assert.equal(mode(path.join(HOME, b[0])), 0o600);

        const secretsBefore = read(SECRETS);
        quiet(() => installer.migrateMcpSecrets());
        assert.equal(read(f), after, 'second run changes nothing');
        assert.equal(read(SECRETS), secretsBefore);
        assert.equal(baks(f).length, 1, 'second run makes no backup');
    });

    test('never overwrites a stored value; differing inline value is dropped with a warning that names no value', () => {
        reset();
        write(SECRETS, `GITHUB_PERSONAL_ACCESS_TOKEN=${T.stored}\n`, 0o600);
        const f = json(path.join(HOME, '.claude.json'), { mcpServers: { github: { command: 'npx', args: GH_ARGS, env: { GITHUB_PERSONAL_ACCESS_TOKEN: T.gh } } } });
        const out = quiet(() => installer.migrateMcpSecrets());
        noToken(out, 'migration log');
        assert.match(out, /kept the stored value/);
        assert.equal(sec.parseEnvText(read(SECRETS)).GITHUB_PERSONAL_ACCESS_TOKEN, T.stored);
        noToken(read(f), 'config');
    });

    test('Codex config.toml (CODEX_HOME honoured): inline env moves out, user tables stay', () => {
        reset();
        const home = fresh();
        process.env.CODEX_HOME = home;
        try {
            const f = write(path.join(home, 'config.toml'), [
                '[features]', 'hooks = true', '',
                '[mcp_servers.github]', 'command = "npx"', `args = ${JSON.stringify(GH_ARGS)}`, `env = { GITHUB_PERSONAL_ACCESS_TOKEN = "${T.gh}" }`, '',
                '[mcp_servers.mine]', 'command = "mine"', '',
            ].join('\n'));
            const out = quiet(() => installer.migrateMcpSecrets());
            noToken(out, 'migration log');
            const text = read(f);
            noToken(text, 'config.toml');
            assert.ok(text.includes('"--vars", "GITHUB_PERSONAL_ACCESS_TOKEN"'));
            assert.ok(text.includes('[mcp_servers.mine]') && text.includes('[features]'));
            assert.equal(sec.parseEnvText(read(SECRETS)).GITHUB_PERSONAL_ACCESS_TOKEN, T.gh);
            assert.equal(baks(f).length, 1);
            const again = text;
            quiet(() => installer.migrateMcpSecrets());
            assert.equal(read(f), again, 'idempotent');
        } finally { delete process.env.CODEX_HOME; }
    });

    test('CLAUDE_CONFIG_DIR is scanned and OpenCode environment blocks migrate', () => {
        reset();
        const cfg = fresh();
        process.env.CLAUDE_CONFIG_DIR = cfg;
        const savedAppData = process.env.APPDATA;
        if (process.platform === 'win32') process.env.APPDATA = path.join(HOME, 'AppData', 'Roaming');
        try {
            const f = json(path.join(cfg, '.claude.json'), { mcpServers: { github: { command: 'npx', args: GH_ARGS, env: { GITHUB_PERSONAL_ACCESS_TOKEN: T.gh } } } });
            const oc = json(path.join(HOME, '.config', 'opencode', 'opencode.json'), { mcp: { memb_mcp: { type: 'local', enabled: true, command: ['/h/.gemini/config/mcps/memb-mcp/.venv/bin/python', '/h/.gemini/config/mcps/memb-mcp/run.py'], environment: { GEMINI_API_KEY: T.gem } } } });
            quiet(() => installer.migrateMcpSecrets());
            noToken(read(f), 'CLAUDE_CONFIG_DIR config');
            noToken(read(oc), 'opencode.json');
            const e = JSON.parse(read(oc)).mcp.memb_mcp;
            assert.equal(e.type, 'local');
            assert.equal(e.enabled, true);
            assert.equal(e.command[0], 'node');
            assert.equal(e.environment, undefined);
            const stored = sec.parseEnvText(read(SECRETS));
            assert.equal(stored.GITHUB_PERSONAL_ACCESS_TOKEN, T.gh);
            assert.equal(stored.GEMINI_API_KEY, T.gem);
        } finally { delete process.env.CLAUDE_CONFIG_DIR; if (savedAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = savedAppData; }
    });
});

describe('aos-doctor', () => {
    const doctor = (home) => {
        const r = spawnSync(process.execPath, [DOCTOR, '--json'], { cwd: home, env: { HOME: home, USERPROFILE: home, PATH: `/usr/bin:/bin` }, encoding: 'utf8' });
        assert.ok(r.stdout, 'doctor produced output');
        noToken(r.stdout + r.stderr, 'doctor output');
        return JSON.parse(r.stdout).results;
    };

    test('flags an inline token by file, server and variable, and a 0644 secrets file', () => {
        const h = fresh();
        json(path.join(h, '.claude.json'), { mcpServers: {
            github: { command: 'npx', args: GH_ARGS, env: { GITHUB_PERSONAL_ACCESS_TOKEN: T.gh } },
            tokenlike: { command: 'x', env: { WHATEVER: T.other } },
            clean: { command: 'node', args: ['/x/aos-mcp-env.mjs', '--vars', 'GITHUB_PERSONAL_ACCESS_TOKEN', '--', 'npx'], env: { OD_DAEMON_URL: 'http://127.0.0.1:3000' } },
        } });
        write(path.join(h, '.aos', 'secrets.env'), `GITHUB_PERSONAL_ACCESS_TOKEN=${T.gh}\n`, 0o644);
        const res = doctor(h);
        const inline = res.filter((r) => r.name === 'MCP inline secret');
        assert.equal(inline.length, 2);
        const gh = inline.find((r) => r.detail.includes('"github"'));
        assert.ok(gh.detail.includes('.claude.json') && gh.detail.includes('GITHUB_PERSONAL_ACCESS_TOKEN'));
        assert.ok(inline.find((r) => r.detail.includes('"tokenlike"') && r.detail.includes('WHATEVER')));
        assert.ok(!inline.some((r) => r.detail.includes('"clean"')));
        const file = res.find((r) => r.name === 'MCP secrets file');
        if (process.platform !== 'win32') assert.ok(!file.ok && file.warningOnly && /mode 644/.test(file.detail));
    });

    test('a clean setup with a 0600 file reports no inline secret and an ok secrets file', () => {
        const h = fresh();
        write(path.join(h, '.aos', 'secrets.env'), 'GITHUB_PERSONAL_ACCESS_TOKEN=x\n', 0o600);
        const res = doctor(h);
        assert.equal(res.filter((r) => r.name === 'MCP inline secret').length, 0);
        assert.ok(res.find((r) => r.name === 'MCP secrets file').ok);
    });
});

describe('uninstall', () => {
    test('removes launcher entries AOS owns, keeps user entries and the secrets file, says so', () => {
        const h = fresh();
        const launcher = path.join(h, '.agents', 'bin', 'aos-mcp-env.mjs');
        const f = json(path.join(h, '.claude.json'), { mcpServers: {
            github: { command: 'node', args: [launcher, '--vars', 'GITHUB_PERSONAL_ACCESS_TOKEN', '--', 'npx', ...GH_ARGS] },
            mine: { command: 'node', args: [launcher, '--vars', 'X', '--', 'mine'] },
            other: { command: 'mine2' },
        } });
        const sf = write(path.join(h, '.aos', 'secrets.env'), 'GITHUB_PERSONAL_ACCESS_TOKEN=fake\n', 0o600);
        const lines = records.reverseRegistrations({ home: h });
        const s = JSON.parse(read(f)).mcpServers;
        assert.equal(s.github, undefined);
        assert.ok(s.mine && s.other, 'entries AOS does not own stay');
        assert.ok(fs.existsSync(sf), 'secrets file stays');
        assert.ok(lines.some((l) => l.includes('secrets.env') && /is kept/.test(l)));
        assert.equal(baks(f).length, 1);
    });

    test('an opencode.jsonc left with only $schema after the launcher entries go is removed; with a foreign key it stays', () => {
        const h = fresh();
        const launcher = path.join(h, '.agents', 'bin', 'aos-mcp-env.mjs');
        const entry = { type: 'local', command: ['node', launcher, '--vars', 'GITHUB_PERSONAL_ACCESS_TOKEN', '--', 'npx', ...GH_ARGS] };
        const f = json(path.join(h, '.config', 'opencode', 'opencode.jsonc'), { $schema: 'https://opencode.ai/config.json', mcp: { github: entry } });
        records.reverseRegistrations({ home: h });
        assert.ok(!fs.existsSync(f), 'AOS-only file removed');
        const h2 = fresh();
        const l2 = path.join(h2, '.agents', 'bin', 'aos-mcp-env.mjs');
        const f2 = json(path.join(h2, '.config', 'opencode', 'opencode.jsonc'), { theme: 'dark', mcp: { github: { ...entry, command: ['node', l2, '--vars', 'GITHUB_PERSONAL_ACCESS_TOKEN', '--', 'npx', ...GH_ARGS] } } });
        records.reverseRegistrations({ home: h2 });
        assert.deepEqual(JSON.parse(read(f2)), { theme: 'dark' });
    });

    test('a launcher-form entry with a shipped name but a foreign command stays (JSON and TOML)', () => {
        const h = fresh();
        const launcher = path.join(h, '.agents', 'bin', 'aos-mcp-env.mjs');
        const f = json(path.join(h, '.claude.json'), { mcpServers: { github: { command: 'node', args: [launcher, '--vars', 'X', '--', 'my-own-github'] } } });
        const toml = write(path.join(h, '.codex', 'config.toml'), `[mcp_servers.github]\ncommand = "node"\nargs = ${JSON.stringify([launcher, '--vars', 'X', '--', 'my-own-github'])}\n`);
        records.reverseRegistrations({ home: h });
        assert.ok(JSON.parse(read(f)).mcpServers.github);
        assert.ok(read(toml).includes('my-own-github'));
    });
});

describe('review round', () => {
    const tomlWith = (envLine) => [`[mcp_servers.github]`, 'command = "npx"', `args = ${JSON.stringify(GH_ARGS)}`, envLine, ''].join('\n');

    test('B1: single-quoted TOML env values are read and moved, with a backup', () => {
        reset();
        const f = write(path.join(fresh(), 'config.toml'), tomlWith(`env = { GITHUB_PERSONAL_ACCESS_TOKEN = '${T.gh}' }`));
        const out = quiet(() => installer.mergeCodexTomlMcpServers(f, { github: { command: 'npx', args: GH_ARGS } }));
        noToken(out, 'log');
        noToken(read(f), 'config.toml');
        assert.equal(sec.parseEnvText(read(SECRETS)).GITHUB_PERSONAL_ACCESS_TOKEN, T.gh);
        assert.equal(baks(f).length, 1);
    });

    test('B1: an env table the reader cannot fully account for is kept untouched', () => {
        reset();
        const f = write(path.join(fresh(), 'config.toml'), tomlWith(`env = { GITHUB_PERSONAL_ACCESS_TOKEN = "${T.gh}", NESTED = { a = 1 } }`));
        const before = read(f);
        let skipped;
        const out = quiet(() => { skipped = installer.mergeCodexTomlMcpServers(f, { github: { command: 'npx', args: GH_ARGS } }); });
        assert.deepEqual(skipped, ['github']);
        assert.match(out, /cannot rewrite safely/);
        assert.ok(read(f).includes(T.gh), 'the only copy of the token is still there');
        assert.ok(read(f).startsWith(before.trimEnd().split('\n')[0]));
        assert.equal(read(SECRETS), '');
    });

    test('B1: every config.toml rewrite is backed up, secrets or not', () => {
        const f = write(path.join(fresh(), 'config.toml'), '[features]\nhooks = true\n');
        quiet(() => installer.mergeCodexTomlMcpServers(f, { deja: { command: 'deja', args: ['mcp'] } }));
        assert.equal(baks(f).length, 1);
    });

    test('B2: a legacy unpinned github entry counts as AOS-owned and migrates', () => {
        reset();
        const f = json(path.join(HOME, '.claude.json'), { mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: T.gh } } } });
        quiet(() => installer.migrateMcpSecrets());
        noToken(read(f), 'config');
        assert.equal(sec.parseEnvText(read(SECRETS)).GITHUB_PERSONAL_ACCESS_TOKEN, T.gh);
        const shipped = sec.shippedServers(ROOT);
        for (const [name, args] of [['chrome-devtools', ['-y', '@modelcontextprotocol/server-puppeteer']], ['open_design_mcp', ['-y', 'open-design-mcp', '/x/mcps/open-design']]]) {
            assert.ok(sec.isAosOwned(name, { command: 'npx', args }, null, shipped), name);
        }
        assert.ok(!sec.isAosOwned('github', { command: 'npx', args: ['-y', 'evil'] }, null, shipped));
    });

    test('S1: the launcher starts the server without secrets when its lib is missing', () => {
        const d = fresh();
        const copy = path.join(d, 'bin', 'aos-mcp-env.mjs');
        write(copy, read(LAUNCHER));
        const r = spawnSync(process.execPath, [copy, '--vars', 'A_TOK', '--', process.execPath, '-e', 'console.log("up")'], { env: { HOME: d, PATH: process.env.PATH }, encoding: 'utf8' });
        assert.equal(r.status, 0);
        assert.match(r.stdout, /up/);
        assert.match(r.stderr, /not found next to this launcher/);
    });

    test('S2: backups are 0600 and one notice names them as plaintext', () => {
        reset();
        const f = json(path.join(HOME, '.claude.json'), { mcpServers: { github: { command: 'npx', args: GH_ARGS, env: { GITHUB_PERSONAL_ACCESS_TOKEN: T.gh } } } });
        const out = quiet(() => installer.migrateMcpSecrets());
        noToken(out, 'log');
        const named = baks(f).sort().pop();
        assert.match(out, /plaintext secrets/);
        assert.ok(out.includes(named));
        assert.equal(mode(path.join(HOME, named)), 0o600);
    });

    test('S5: a project .cursor/mcp.json and a recorded custom path are migrated', () => {
        reset();
        const proj = fresh();
        const cursor = json(path.join(proj, '.cursor', 'mcp.json'), { mcpServers: { github: { command: 'npx', args: GH_ARGS, env: { GITHUB_PERSONAL_ACCESS_TOKEN: T.gh } } } });
        const custom = json(path.join(fresh(), 'custom', 'my_mcp.json'), { mcpServers: { memb_mcp: { command: '/h/.gemini/config/mcps/memb-mcp/.venv/bin/python', args: ['/h/.gemini/config/mcps/memb-mcp/run.py'], env: { GEMINI_API_KEY: T.gem } } } });
        write(path.join(HOME, '.agents', '.bdb-uninstall-records.json'), JSON.stringify({ mcpConfigs: [custom] }));
        const cwd = process.cwd();
        process.chdir(proj);
        try { quiet(() => installer.migrateMcpSecrets()); } finally { process.chdir(cwd); }
        noToken(read(cursor), 'project cursor config');
        noToken(read(custom), 'custom config');
        const stored = sec.parseEnvText(read(SECRETS));
        assert.equal(stored.GITHUB_PERSONAL_ACCESS_TOKEN, T.gh);
        assert.equal(stored.GEMINI_API_KEY, T.gem);
    });

    test('NIT: storeSecrets values round-trip byte for byte (quotes, backslashes, hash, spaces)', () => {
        const f = path.join(fresh(), 'secrets.env');
        const vals = { A_ONE: 'a"b\\c #x ', A_TWO: "'quoted'", A_THREE: '  lead' };
        sec.storeSecrets(f, vals);
        assert.deepEqual(sec.parseEnvText(read(f)), vals);
        assert.equal(mode(f), 0o600);
        assert.deepEqual(sec.storeSecrets(f, { A_ONE: 'other' }).kept, ['A_ONE']);
    });

    test('NIT: addClaudeDeny backs up settings.json first and keeps its mode', () => {
        const h = fresh();
        const s = write(path.join(h, 'settings.json'), JSON.stringify({ permissions: { deny: ['Bash(a)'] } }), 0o600);
        const added = records.addClaudeDeny({ home: h, settingsPath: s, rules: ['Bash(b)'] });
        assert.deepEqual(added, ['Bash(b)']);
        assert.equal(mode(s), 0o600);
        const b = baks(s);
        assert.equal(b.length, 1);
        assert.deepEqual(JSON.parse(read(path.join(h, b[0]))).permissions.deny, ['Bash(a)']);
    });

    test('C2: harnessMcpFiles dedupes symlink pairs by realpath', () => {
        const h = fresh();
        const geminiDir = path.join(h, '.gemini', 'config');
        const agyCliDir = path.join(h, '.gemini', 'antigravity-cli');
        fs.mkdirSync(geminiDir, { recursive: true });
        const realFile = path.join(geminiDir, 'mcp_config.json');
        fs.writeFileSync(realFile, JSON.stringify({ mcpServers: {} }));
        fs.mkdirSync(agyCliDir, { recursive: true });
        const symlinkFile = path.join(agyCliDir, 'mcp_config.json');
        try {
            fs.symlinkSync(realFile, symlinkFile);
        } catch {
            return;
        }
        const files = sec.harnessMcpFiles(h, {}, 'linux', h);
        const agyFiles = files.filter((f) => f.file.startsWith(path.join(h, '.gemini')) && f.file.endsWith('mcp_config.json'));
        assert.equal(agyFiles.length, 1, 'symlink pair to same real file must be deduped to one');
    });
});
