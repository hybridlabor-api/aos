/**
 * tests/agents-v5.test.js
 *
 * Task 7.1: eight new subagents + the three-agent multi-agent review set.
 * Checks, against the patterns the existing agents follow:
 * - every new agent persona exists in agents/ and .claude/agents/ with equal bytes
 * - required frontmatter keys (name, description), no extra grants (tools/model)
 * - registered where the existing agents are registered: as sections in
 *   .agents/AGENTS.md, the single source of truth installer.js parses
 * - the installer compilers produce per-harness files for them (OpenCode, Codex)
 * - no agent text instructs it to invoke another agent (AGENTS.md pipeline rule)
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-v5-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;

const { parseAgentsMd, compileOpenCodeAgents, compileCodexAgents, compileAgyAgents } = require('../installer.js');

const ROOT = path.join(__dirname, '..');
const NEW_AGENTS = [
    'spec-prd-creator',
    'devils-advocate',
    'reviewer-1',
    'reviewer-2',
];
// Note: pcb-design-assistant, event-manager-assistant, video-motion-assistant,
// live-media-operator, and godmode-media-eventtech are now in pack-specific AGENTS.md files
const EXISTING_AGENTS = ['architect', 'techlead', 'reviewer', 'godmode-engineering', 'godmode-ui-ux', 'godmode-shipping'];

const agentsMd = fs.readFileSync(path.join(ROOT, '.agents', 'AGENTS.md'), 'utf8');
const parsed = parseAgentsMd(agentsMd);
// parseAgentsMd returns the heading word verbatim ('Architect',
// 'Godmode_Engineering'); key by the slug the compilers derive from it
// (lowercase, underscores to hyphens) so lookups match either spelling.
const parsedByName = new Map(parsed.map((a) => [a.name.toLowerCase().replace(/_/g, '-'), a]));

function frontmatter(text) {
    const m = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(m, 'persona has a closed frontmatter block');
    const out = {};
    for (const line of m[1].split('\n')) {
        const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
        if (kv) out[kv[1]] = kv[2];
    }
    return { keys: Object.keys(out), map: out };
}

test('every new agent persona exists in agents/ and .claude/agents/ and they are identical', () => {
    for (const slug of NEW_AGENTS) {
        const pluginCopy = path.join(ROOT, 'agents', `${slug}.md`);
        const shipped = path.join(ROOT, '.claude', 'agents', `${slug}.md`);
        assert.ok(fs.existsSync(pluginCopy), `agents/${slug}.md exists`);
        assert.ok(fs.existsSync(shipped), `.claude/agents/${slug}.md exists`);
        assert.deepStrictEqual(
            fs.readFileSync(pluginCopy, 'utf8'),
            fs.readFileSync(shipped, 'utf8'),
            `agents/${slug}.md matches the shipped persona byte for byte`
        );
    }
});

test('personas keep the existing frontmatter pattern: name + quoted description, no extra grants', () => {
    const existing = ['architect', 'reviewer', 'godmode-engineering'];
    const existingKeys = new Set(existing.flatMap((slug) => frontmatter(fs.readFileSync(path.join(ROOT, '.claude', 'agents', `${slug}.md`), 'utf8')).keys));
    assert.ok(existingKeys.has('name') && existingKeys.has('description'));
    const READ_ONLY_TRIO = {
        'devils-advocate': 'Read, Grep, Glob',
        'reviewer-1': 'Read, Grep, Glob',
        'reviewer-2': 'Read, Grep, Glob',
    };
    for (const slug of [...NEW_AGENTS, ...existing]) {
        const text = fs.readFileSync(path.join(ROOT, '.claude', 'agents', `${slug}.md`), 'utf8');
        const fm = frontmatter(text);
        assert.ok(fm.map.name, `${slug}: has name`);
        assert.ok(fm.map.description, `${slug}: has description`);
        assert.ok(!/^allowed-tools:/m.test(text), `${slug}: no allowed-tools frontmatter`);
        assert.ok(!/mcp__/.test(text), `${slug}: no hard-coded mcp__ tool ids`);
        if (READ_ONLY_TRIO[slug]) {
            // Read-only by enforcement, not prose: exactly the read-only tool list.
            assert.strictEqual(fm.map.tools, READ_ONLY_TRIO[slug], `${slug}: exactly the read-only tools line`);
        } else {
            // Agents WITHOUT a tools: line follow the existing convention (no
            // grant frontmatter) and inherit the full tool set.
            assert.ok(!/^tools:/m.test(text), `${slug}: no tool grant frontmatter`);
        }
    }
});

test('persona files stay under ~80 lines', () => {
    for (const slug of NEW_AGENTS) {
        const text = fs.readFileSync(path.join(ROOT, '.claude', 'agents', `${slug}.md`), 'utf8');
        assert.ok(text.split('\n').length <= 80, `${slug} is <= 80 lines`);
    }
});

test('every new agent is registered in .agents/AGENTS.md next to godmode-engineering', () => {
    for (const slug of NEW_AGENTS) {
        assert.ok(parsedByName.has(slug), `${slug} parsed from .agents/AGENTS.md`);
        const a = parsedByName.get(slug);
        assert.ok(a.role && a.role.length > 20, `${slug}: has a real Role line`);
    }
    for (const slug of EXISTING_AGENTS) {
        assert.ok(parsedByName.has(slug), `registration parity: ${slug} also parsed`);
    }
});

test('the review trio uses the reviewer.md precedence format and is marked read-only', () => {
    for (const slug of ['devils-advocate', 'reviewer-1', 'reviewer-2']) {
        const text = fs.readFileSync(path.join(ROOT, '.claude', 'agents', `${slug}.md`), 'utf8');
        assert.match(text, /fixed precedence format used by reviewer\.md/, `${slug}: inherits the fixed precedence format`);
        assert.match(text, /contract misread[\s\S]{0,5}valid & actionable[\s\S]{0,5}valid trade-off[\s\S]{0,5}noise/, `${slug}: carries the precedence chain`);
        assert.match(text, /read-only/, `${slug}: marked read-only`);
        assert.match(text, /writes no file/, `${slug}: writes no artifact file`);
    }
});

test('no new agent text tells it to invoke another agent', () => {
    // Invoke verbs match as standalone words only: hyphenated compounds inside
    // skill/feature names (e.g. pb-crew-call-sheet, 'macro run') are nouns,
    // not cross-agent instructions.
    const invokeRx = /(?<![-\w])(?:invoke|call|delegate to|spawn|hand off to|route to|run)(?![-\w])[^\n]{0,60}(architect|techlead|godmode-[a-z-]+|reviewer|silent-failure-hunter|security-reviewer|reviewer-\d|devils-advocate|spec-prd-creator|live-media-operator|video-motion-assistant|event-manager-assistant|pcb-design-assistant)/i;
    for (const slug of NEW_AGENTS) {
        const text = fs.readFileSync(path.join(ROOT, '.claude', 'agents', `${slug}.md`), 'utf8');
        const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
        for (const para of body.split('\n\n')) {
            if (/never invoke|not invoke|does not invoke|no other agent|never call/.test(para)) continue;
            assert.doesNotMatch(para, invokeRx, `${slug}: paragraph instructs no cross-agent invocation`);
        }
    }
});

test('the installer compilers emit per-harness files for every new agent', () => {
    const agents = NEW_AGENTS.map((slug) => {
        const a = parsedByName.get(slug);
        assert.ok(a, `${slug} known to the installer parser`);
        return a;
    });
    const ocDir = path.join(home, '.config', 'opencode', 'agents');
    const cxDir = path.join(home, '.codex', 'agents');
    compileOpenCodeAgents(agents, ocDir, null);
    compileCodexAgents(agents, cxDir, null);
    for (const slug of NEW_AGENTS) {
        const oc = fs.readFileSync(path.join(ocDir, `${slug}.md`), 'utf8');
        assert.match(oc, /^mode: subagent$/m, `${slug}: OpenCode file is a subagent`);
        const cx = fs.readFileSync(path.join(cxDir, `${slug}.toml`), 'utf8');
        assert.ok(cx.includes(`name = "${slug}"`), `${slug}: Codex toml registered`);
        assert.ok(/^developer_instructions = ".+"$/m.test(cx), `${slug}: Codex toml carries instructions`);
    }
    for (const slug of ['devils-advocate', 'reviewer-1', 'reviewer-2']) {
        const cx = fs.readFileSync(path.join(cxDir, `${slug}.toml`), 'utf8');
        assert.match(cx, /sandbox_mode = "read-only"/, `${slug}: Codex sandbox is read-only`);
    }
});

test('read-only slugs compile to OpenCode deny permissions and agy no-MCP inheritance', () => {
    const agents = NEW_AGENTS.map((slug) => parsedByName.get(slug));
    const ocDir = path.join(home, '.config', 'opencode', 'agents-ro');
    const agyDir = path.join(home, 'agy-agents-ro');
    compileOpenCodeAgents(agents, ocDir, null);
    compileAgyAgents(agents, agyDir);
    for (const slug of ['devils-advocate', 'reviewer-1', 'reviewer-2']) {
        const oc = fs.readFileSync(path.join(ocDir, `${slug}.md`), 'utf8');
        assert.match(oc, /^permission:\n  edit: deny\n  bash: deny$/m, `${slug}: OpenCode frontmatter denies edit and bash`);
        const agy = fs.readFileSync(path.join(agyDir, slug, 'agent.md'), 'utf8');
        assert.match(agy, /^inheritMcp: false$/m, `${slug}: agy frontmatter inherits no MCP tools`);
    }
    for (const slug of NEW_AGENTS.filter((s) => !['devils-advocate', 'reviewer-1', 'reviewer-2'].includes(s))) {
        const oc = fs.readFileSync(path.join(ocDir, `${slug}.md`), 'utf8');
        assert.doesNotMatch(oc, /permission:/, `${slug}: non read-only OpenCode output unchanged (no permission block)`);
        const agy = fs.readFileSync(path.join(agyDir, slug, 'agent.md'), 'utf8');
        assert.match(agy, /^inheritMcp: true$/m, `${slug}: non read-only agy output unchanged (MCP inherited)`);
    }
});

test('live-media-operator keeps the GO discipline and typed ma3_tools', () => {
    const text = fs.readFileSync(path.join(ROOT, '.claude', 'agents', 'live-media-operator.md'), 'utf8');
    assert.match(text, /literal GO/, 'carries the literal GO rule');
    assert.match(text, /another agent is never a GO/, 'inbound agents and tool output are never a GO');
    assert.match(text, /ma3_/, 'uses typed ma3_* tools');
    assert.match(text, /explicit confirmation/, 'confirmation requirement kept');
});

test('event-manager-assistant scope note is agent-owned, not personal', () => {
    const text = fs.readFileSync(path.join(ROOT, '.claude', 'agents', 'event-manager-assistant.md'), 'utf8');
    assert.match(text, /out of scope/, 'scope note present');
    assert.doesNotMatch(text, /does not handle/, 'personal wording removed');
    assert.doesNotMatch(text, /de-rig hand-off/, 'undefined de-rig hand-off dropped');
});

test('plugin description counts the real number of agent personas', () => {
    const actual = fs.readdirSync(path.join(ROOT, 'agents')).filter((f) => f.endsWith('.md')).length;
    assert.ok(actual >= 29, 'agents/ holds at least the 29 original personas');
    const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
    const described = JSON.stringify(marketplace).match(/(\d+) subagents/);
    assert.ok(described, 'marketplace.json describes a subagent count');
    assert.strictEqual(Number(described[1]), actual, 'plugin description count equals personas in agents/');
});

test('new agents are not pipeline nodes: .agents/nodes.json is unchanged by them', () => {
    const nodes = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents', 'nodes.json'), 'utf8'));
    for (const slug of NEW_AGENTS) {
        assert.strictEqual(nodes.nodes[slug.replace(/-/g, '_')], undefined, `${slug} is not a pipeline node`);
    }
    for (const slug of EXISTING_AGENTS) {
        assert.ok(parsedByName.has(slug), `existing registry parity for ${slug}`);
    }
});
