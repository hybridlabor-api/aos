// F4: the Codex CLI drops marker comments when it rewrites config.toml. Uninstall and the MCP merge
// must work without markers. Temp dirs only, no real CLI.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ur = require('../lib/uninstall-records.js');
const { mergeCodexTomlMcpServers } = require('../installer.js');

const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-f4-'));
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const SERVERS = { bdb_td_backup: { command: 'node', args: ['/x/td.js'] }, github: { command: 'npx', args: ['-y', 'gh'] } };
const HOOKS = `[[hooks.PreToolUse]]
[[hooks.PreToolUse.hooks]]
type = "command"
command = "node \\"/h/.codex/hooks/go-gate.mjs\\""

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "node \\"/h/.codex/hooks/trail-relay.mjs\\" --agent codex --event Stop"

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "node /mine/my-hook.js"
`;
const USER = '[model]\nname = "x"\n\n[mcp_servers.userone]\ncommand = "u"\n';

test('merge: markers dropped by Codex -> no second block, 3 runs byte-identical', () => {
    const tmp = mk();
    try {
        const f = path.join(tmp, 'config.toml');
        fs.writeFileSync(f, USER);
        mergeCodexTomlMcpServers(f, SERVERS);
        const first = fs.readFileSync(f, 'utf8');
        fs.writeFileSync(f, first.split('\n').filter((l) => !l.startsWith('# AOS:')).join('\n'));
        mergeCodexTomlMcpServers(f, SERVERS);
        const second = fs.readFileSync(f, 'utf8');
        mergeCodexTomlMcpServers(f, SERVERS);
        const third = fs.readFileSync(f, 'utf8');
        assert.strictEqual(second, first);
        assert.strictEqual(third, first);
        assert.strictEqual(second.split('# AOS:MCP:START').length - 1, 1);
        assert.strictEqual(second.split('# AOS:MCP:END').length - 1, 1);
        assert.strictEqual(second.split('[mcp_servers.bdb_td_backup]').length - 1, 1);
    } finally { rm(tmp); }
});

test('merge: same-name table with a different command is kept as user table', () => {
    const tmp = mk();
    try {
        const f = path.join(tmp, 'config.toml');
        fs.writeFileSync(f, '[mcp_servers.bdb_td_backup]\ncommand = "mine"\n');
        const skipped = mergeCodexTomlMcpServers(f, SERVERS);
        assert.deepStrictEqual(skipped, ['bdb_td_backup']);
        assert.strictEqual(fs.readFileSync(f, 'utf8').split('[mcp_servers.bdb_td_backup]').length - 1, 1);
    } finally { rm(tmp); }
});

test('uninstall: marker-less config loses AOS hooks and MCP tables, foreign entries survive', () => {
    const home = mk();
    try {
        const f = path.join(home, '.codex', 'config.toml');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, `${USER}\n${HOOKS}\n[mcp_servers.bdb_td_backup]\ncommand = "node"\nargs = ["/x/td.js"]\n\n[mcp_servers.github]\ncommand = "mine"\n# AOS:MCP:END\n`);
        ur.reverseRegistrations({ home });
        const out = fs.readFileSync(f, 'utf8');
        assert.doesNotMatch(out, /go-gate|trail-relay|bdb_td_backup|AOS:/);
        for (const keep of ['[model]', '[mcp_servers.userone]', 'my-hook.js', '[mcp_servers.github]', 'command = "mine"']) assert.ok(out.includes(keep), `${keep} lost:\n${out}`);
    } finally { rm(home); }
});

test('uninstall: intact MCP block is removed, user table inside survives', () => {
    const home = mk();
    try {
        const f = path.join(home, '.codex', 'config.toml');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, '[model]\nname = "x"\n\n# AOS:MCP:START\n[mcp_servers.github]\ncommand = "npx"\n\n[mcp_servers.zzuser]\ncommand = "zz"\n# AOS:MCP:END\n');
        ur.reverseRegistrations({ home });
        const out = fs.readFileSync(f, 'utf8');
        assert.doesNotMatch(out, /AOS:|mcp_servers.github/);
        assert.ok(out.includes('[mcp_servers.zzuser]') && out.includes('[model]'));
    } finally { rm(home); }
});
