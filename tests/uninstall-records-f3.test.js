// F3 uninstaller regressions (H-3, M-c, M-d, LOW): Codex tables AOS does not own, JSONC comments,
// CLAUDE_CONFIG_DIR, AOS_PLUGIN_CLI=on. Pure functions on temp HOMEs; no real CLI.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ur = require('../lib/uninstall-records.js');
const { removeJsoncArrayEntries, parseJsonc } = require('../lib/jsonc.js');

const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-urf3-'));
const write = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });

const AOS_BLOCK = `# AOS:HOOKS:START
[[hooks.PreToolUse]]
matcher = "^(Bash)$"
[[hooks.PreToolUse.hooks]]
type = "command"
command = "node \\"/h/.codex/hooks/go-gate.mjs\\""
timeout = 30

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "node \\"/h/.codex/hooks/trail-relay.mjs\\" --agent codex --event Stop"
timeout = 2
# AOS:HOOKS:END
`;

test('Codex uninstall keeps user tables the codex CLI put inside the AOS block', () => {
    const home = mk();
    try {
        const f = path.join(home, '.codex', 'config.toml');
        const inside = AOS_BLOCK.replace('[[hooks.Stop]]', '[marketplaces.bdb-aos]\nsource = "x"\n\n[plugins."bdb-aos@bdb-aos"]\nenabled = true\n\n[mcp_servers.zzuser]\ncommand = "zz"\n\n[[hooks.Stop]]');
        write(f, `[features]\nhooks = true\n\n${inside}`);
        ur.reverseRegistrations({ home });
        const out = fs.readFileSync(f, 'utf8');
        assert.doesNotMatch(out, /AOS:HOOKS|go-gate|trail-relay/);
        for (const keep of ['[features]', '[marketplaces.bdb-aos]', '[plugins."bdb-aos@bdb-aos"]', '[mcp_servers.zzuser]', 'command = "zz"']) assert.ok(out.includes(keep), `${keep} lost:\n${out}`);
    } finally { rm(home); }
});

test('Codex uninstall of a pure AOS block leaves the rest exactly', () => {
    const home = mk();
    try {
        const f = path.join(home, '.codex', 'config.toml');
        write(f, `[model]\nname = "x"\n\n${AOS_BLOCK}`);
        ur.reverseRegistrations({ home });
        assert.strictEqual(fs.readFileSync(f, 'utf8').trimEnd(), '[model]\nname = "x"');
    } finally { rm(home); }
});

test('OpenCode uninstall removes only the plugin[] entry textually; comments survive', () => {
    const home = mk();
    try {
        const dir = path.join(home, '.config', 'opencode');
        const plugin = path.join(dir, 'plugins', 'bdb-aos.js');
        const f = path.join(dir, 'opencode.jsonc');
        const text = `{\n  // my theme\n  "theme": "dark", /* keep */\n  "plugin": [\n    "other-plugin", // mine\n    "file://${plugin}",\n    "third"\n  ]\n}\n`;
        write(f, text);
        ur.reverseRegistrations({ home });
        const out = fs.readFileSync(f, 'utf8');
        assert.ok(out.includes('// my theme') && out.includes('/* keep */') && out.includes('// mine'), out);
        assert.deepStrictEqual(parseJsonc(out).plugin, ['other-plugin', 'third']);
        assert.ok(fs.readdirSync(dir).some((n) => n.endsWith('.bak')), 'backup kept');
    } finally { rm(home); }
});

test('removeJsoncArrayEntries: last element, only element, nested arrays, strings with // and unrelated keys', () => {
    const isX = (v) => (Array.isArray(v) ? v[0] : v) === 'x';
    assert.deepStrictEqual(parseJsonc(removeJsoncArrayEntries('{"a":"http://x","plugin":["a","x"]}', 'plugin', isX)).plugin, ['a']);
    assert.deepStrictEqual(parseJsonc(removeJsoncArrayEntries('{"plugin":["x"]}', 'plugin', isX)).plugin, []);
    assert.deepStrictEqual(parseJsonc(removeJsoncArrayEntries('{"plugin":[["x",{"k":1}],"y"],"other":{"plugin":["x"]}}', 'plugin', isX)), { plugin: ['y'], other: { plugin: ['x'] } });
    assert.strictEqual(removeJsoncArrayEntries('{"nope":[]}', 'plugin', isX), null);
});

test('CLAUDE_CONFIG_DIR: aos-bus launcher ownership follows the config dir', () => {
    const home = mk();
    const old = process.env.CLAUDE_CONFIG_DIR;
    try {
        const cfg = path.join(home, 'cfg');
        process.env.CLAUDE_CONFIG_DIR = cfg;
        const target = path.join(cfg, 'hooks', 'aos-bus.mjs');
        write(path.join(home, '.local', 'bin', 'aos-bus'), `#!/bin/sh\nexec node "${target}" "$@"\n`);
        const lines = ur.reverseRegistrations({ home });
        assert.ok(lines.some((l) => l.includes('aos-bus')), lines.join('\n'));
        assert.ok(!fs.existsSync(path.join(home, '.local', 'bin', 'aos-bus')));
    } finally { if (old === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = old; rm(home); }
});

test('reverseClaude honours AOS_PLUGIN_CLI=on on a redirected HOME', () => {
    const home = mk();
    try {
        write(ur.recordsPath(home), JSON.stringify({ claude: { installedPlugin: true } }));
        const calls = [];
        const runner = (args) => { calls.push(args.join(' ')); return { ok: true }; };
        const off = ur.reverseRegistrations({ home, runner, env: {} });
        assert.deepStrictEqual(calls, [], off.join('\n'));
        ur.reverseRegistrations({ home, runner, env: { AOS_PLUGIN_CLI: 'on' } });
        assert.deepStrictEqual(calls, ['plugin uninstall bdb-aos@bdb-marketplace']);
    } finally { rm(home); }
});

test('opencode-verify parseJsonc reads a BOM-prefixed config', () => {
    assert.deepStrictEqual(require('../lib/opencode-verify.js').parseJsonc('﻿{"a":1 // c\n}'), { a: 1 });
});
