const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'v5-agents-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;

const { parseAgentsMd, compileOpenCodeAgents, compileAgyAgents } = require('../installer.js');
const agents = parseAgentsMd(fs.readFileSync(path.join(__dirname, '..', '.agents', 'AGENTS.md'), 'utf8'));

const listFiles = (dir) => fs.readdirSync(dir, { recursive: true }).map(String);

test('OpenCode agents land in ~/.config/opencode/agents with mode: subagent', () => {
    compileOpenCodeAgents(agents, path.join(home, '.config', 'opencode', 'agents'));
    const text = fs.readFileSync(path.join(home, '.config', 'opencode', 'agents', 'architect.md'), 'utf8');
    assert.match(text, /^mode: subagent$/m);
});

test('agy agents are <slug>/agent.md with H1 and subagent: true, no new .json', () => {
    const dir = path.join(home, '.gemini', 'config', 'agents');
    compileAgyAgents(agents, dir);
    const slug = agents[0].name.toLowerCase().replace(/_/g, '-');
    const text = fs.readFileSync(path.join(dir, slug, 'agent.md'), 'utf8');
    assert.match(text, /^# .+$/m);
    assert.match(text, /^subagent: true$/m);
    assert.match(text, /^inheritMcp: true$/m);
    assert.deepStrictEqual(listFiles(dir).filter((f) => f.endsWith('.json')), []);
});

test('agy compile is idempotent and leaves unchanged files alone', () => {
    const dir = path.join(home, '.gemini', 'config', 'agents');
    const slug = agents[0].name.toLowerCase().replace(/_/g, '-');
    const file = path.join(dir, slug, 'agent.md');
    const before = fs.statSync(file).mtimeMs;
    compileAgyAgents(agents, dir);
    assert.strictEqual(fs.statSync(file).mtimeMs, before);
});

test('hostile agent names are rejected before anything is written', () => {
    const dir = path.join(home, 'hostile-agents');
    for (const name of ['../x', 'a/b', '..', '']) {
        assert.throws(() => compileAgyAgents([{ name, role: 'r', systemPrompt: 'p' }], dir), /unsafe agent name/);
    }
    assert.strictEqual(fs.existsSync(dir), false);
    assert.strictEqual(fs.existsSync(path.join(home, 'x')), false);
});

test('A1: Codex agent compiler drops duplicated role in developer_instructions and does not swallow next sections', () => {
    const { compileCodexAgents } = require('../installer.js');
    const codexDir = path.join(home, '.codex', 'agents');
    const parsed = parseAgentsMd(fs.readFileSync(path.join(__dirname, '..', '.agents', 'AGENTS.md'), 'utf8'));
    compileCodexAgents(parsed, codexDir);
    const shippingToml = fs.readFileSync(path.join(codexDir, 'godmode-shipping.toml'), 'utf8');
    assert.ok(!shippingToml.includes('Auxiliary agents'), 'does not swallow Auxiliary agents section');
    const architectToml = fs.readFileSync(path.join(codexDir, 'architect.toml'), 'utf8');
    const archAgent = parsed.find((a) => a.name === 'Architect');
    if (archAgent) {
        assert.ok(!architectToml.includes(`developer_instructions = """\n${archAgent.role}`), 'drops duplicated role at top of instructions');
    }
});


test('OpenCode picker: godmode agents are mode: all, master-session and project-orchestrator are primary', () => {
    const dir = path.join(home, '.config', 'opencode', 'agents');
    compileOpenCodeAgents(agents, dir);
    const read = (slug) => fs.readFileSync(path.join(dir, `${slug}.md`), 'utf8');
    for (const slug of ['godmode-ui-ux', 'godmode-engineering', 'godmode-media-eventtech', 'godmode-shipping']) assert.match(read(slug), /^mode: all$/m, slug);
    assert.match(read('reviewer'), /^mode: subagent$/m);
    assert.match(read('master-session'), /^mode: primary$/m);
    assert.match(read('master-session'), /aos-a2a list/);
    assert.match(read('project-orchestrator'), /ao-orchestrator/);
});
