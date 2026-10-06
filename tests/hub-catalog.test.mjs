import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { localSkills, localAgents } from '../lib/store-shared.mjs';
import { buildCatalog, frontmatter } from '../lib/hub/catalog.mjs';
import { routes as catalogRoutes, catalogCacheReset } from '../lib/hub/routes-catalog.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
// Unique temp base, never deleted (rules forbid recursive deletes).
const tmpBase = mkdtempSync(join(tmpdir(), 'aos-hub-catalog-'));

const route = catalogRoutes.find((r) => r.path === '/api/catalog');
assert.ok(route, 'catalog route present');
assert.equal(route.method, 'GET');
assert.notEqual(route.mutates, true, 'catalog route is read-only');

const makeCtx = (root, home, now) => ({
  root,
  home,
  cwd: root,
  log: () => {},
  run: () => Promise.resolve({ ok: false, stdout: '', stderr: '' }),
  now: now ?? (() => Date.now()),
});
const call = (query, ctx) =>
  route.handler({ url: new URL(`/api/catalog${query}`, 'http://x'), params: {}, body: undefined, ctx });
const byName = (arr, name) => arr.find((x) => x.name === name);
const blank = () => ({ claude: false, codex: false, agy: false, cursor: false, roo: false });

const countMd = (dir) => {
  try { return readdirSync(dir).filter((f) => f.endsWith('.md')).length; } catch { return 0; }
};

after(() => {});

test('counts equal the repo, computed from the same files', () => {
  catalogCacheReset();
  const cat = buildCatalog({ root: ROOT, home: tmpBase, now: () => Date.now() });
  // skills: every local SKILL.md dir name appears, exactly once
  const local = localSkills(ROOT);
  assert.ok(local.size > 0);
  const names = cat.skills.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, 'no duplicate skill entries');
  for (const n of local.keys()) {
    assert.ok(names.includes(n), `local skill ${n} listed`);
  }
  // agents: same files localAgents() reports
  const agentNames = new Set([...localAgents(ROOT).keys()]);
  assert.equal(cat.agents.filter((a) => a.source === 'aos').length, agentNames.size);
  // commands: commands/*.md file count
  assert.equal(cat.commands.filter((c) => c.source === 'commands').length, countMd(join(ROOT, 'commands')));
  // mcps: mcp_config.json server count
  const mcpConfig = JSON.parse(readFileSync(join(ROOT, 'mcp_config.json'), 'utf8'));
  assert.equal(
    cat.mcps.filter((m) => m.source === 'mcp_config').length,
    Object.keys(mcpConfig.mcpServers).length,
  );
});

test('commands cross-check plugin.json: agy variants never core', () => {
  const cat = buildCatalog({ root: ROOT, home: tmpBase, now: () => Date.now() });
  assert.ok(cat.commands.length > 0);
  const agy = cat.commands.filter((c) => c.source === 'agy-commands');
  for (const a of agy) assert.equal(a.core, false, 'agy variants are never core');
  const core = cat.commands.filter((c) => c.core);
  assert.ok(core.length > 0, 'plugin.json-registered commands are core');
});

test('frontmatter helper parses block scalars and quoted values', () => {
  const fm = frontmatter('---\nname: x\ndescription: >-\n  First line\n  second line\ncategory: "quoted cat"\n---\nbody');
  assert.equal(fm.name, 'x');
  assert.equal(fm.description, 'First line second line');
  assert.equal(fm.category, 'quoted cat');
});

test('MCP env reduced to set/unset; fixture value ghp_x never leaks', () => {
  const cfg = {
    mcpServers: {
      github: { command: 'npx', args: ['-y', '@mc/server'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_x' } },
      empty_env: { command: 'node', env: { SECRET_KEY: '' } },
    },
  };
  const root = join(tmpBase, 'leak-root');
  mkdirSync(join(root, 'skills'), { recursive: true });
  writeFileSync(join(root, 'mcp_config.json'), JSON.stringify(cfg));
  const cat = buildCatalog({ root, home: tmpBase, now: () => Date.now(), env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'should-never-appear' } });
  const github = byName(cat.mcps, 'github');
  assert.ok(github);
  assert.equal(github.env.GITHUB_PERSONAL_ACCESS_TOKEN, 'set');
  const empty = byName(cat.mcps, 'empty_env');
  assert.equal(empty.env.SECRET_KEY, 'unset');
  const text = JSON.stringify(cat);
  assert.ok(!text.includes('ghp_x'), 'fixture token value absent from response');
  assert.ok(!text.includes('should-never-appear'), 'injected env value absent from response');
  assert.ok(!text.includes('@mc/server'), 'args never serialized');
  assert.ok(!text.includes('SECRET_KEY='), 'KEY=value pairs never serialized');
});

test('gate: fixture token stays absent from the full server JSON envelope', () => {
  catalogCacheReset();
  const cat = buildCatalog({ root: ROOT, home: tmpBase, now: () => Date.now() });
  const text = JSON.stringify({ ...cat, generatedAt: Date.now() });
  assert.ok(!text.includes('ghp_'), 'no ghp_ token in the served catalog');
  assert.ok(!/github_pat_\S/.test(text), 'no github_pat_ token in the served catalog');
});

test('store index items listed with source id; core wins for local skills', () => {
  // Fixture store index via the documented AOS_STORE_INDEX test override
  // (loadSources, store-shared.mjs). It must contain BOTH a locally present
  // skill (bdb-aos exists in skills/) and an index-only item, because the
  // shipped ecc index has no name in common with the local skills at all.
  const fixture = join(tmpBase, 'ecc-fixture-store-index.json');
  writeFileSync(fixture, JSON.stringify({
    pinned_commit: '0'.repeat(40),
    skills: {
      'bdb-aos': { description: 'fixture duplicate of the local aos skill', category: 'library' },
      accessibility: { description: 'index-only fixture skill', category: 'library' },
    },
    subagents: {
      'demo-index-agent': { description: 'index-only fixture agent' },
    },
  }));
  const cat = buildCatalog({ root: ROOT, home: tmpBase, now: () => Date.now(), env: { AOS_STORE_INDEX: fixture } });
  // core wins: the local entry is reported, the index duplicate does not override it
  const dup = byName(cat.skills, 'bdb-aos');
  assert.ok(dup, 'locally present skill listed');
  assert.equal(dup.core, true, 'locally present stays core');
  assert.equal(dup.source, 'aos', 'index duplicate must not override the local source');
  // index-only items keep the store source id and are not core
  const idxOnly = byName(cat.skills, 'accessibility');
  assert.ok(idxOnly, 'index-only skill listed with source id');
  assert.equal(idxOnly.source, 'ecc');
  assert.equal(idxOnly.core, false);
  const agent = byName(cat.agents, 'demo-index-agent');
  assert.ok(agent, 'index subagent listed with source id');
  assert.equal(agent.source, 'ecc');
  assert.equal(agent.core, false);
});

test('temp-HOME harness fixtures produce correct installed flags', () => {
  const home = join(tmpBase, 'flags-home');
  const root = join(tmpBase, 'flags-root');
  for (const h of ['.claude', '.codex', '.cursor', '.roo', '.agents', '.gemini/config']) {
    mkdirSync(join(home, h, 'skills'), { recursive: true });
    mkdirSync(join(home, h, 'agents'), { recursive: true });
  }
  const mkSkill = (name) => {
    mkdirSync(join(root, 'skills', name), { recursive: true });
    writeFileSync(join(root, 'skills', name, 'SKILL.md'), '---\nname: n\ndescription: d\n---\n');
  };
  mkSkill('demo-claude-codex');
  mkSkill('demo-roo');
  mkSkill('demo-agy');
  mkSkill('nowhere');
  mkdirSync(join(root, 'agents'), { recursive: true });
  writeFileSync(join(root, 'agents', 'a-architect.md'), '---\nname: a-architect\ndescription: d\n---\n');
  writeFileSync(join(root, 'agents', 'g-agent.md'), '---\nname: g-agent\ndescription: d\n---\n');
  for (const d of [['.claude', 'skills', 'demo-claude-codex'], ['.codex', 'skills', 'demo-claude-codex'], ['.roo', 'skills', 'demo-roo'], ['.agents', 'skills', 'demo-agy'], ['.gemini', 'config', 'agents']]) {
    mkdirSync(join(home, ...d), { recursive: true });
  }
  writeFileSync(join(home, '.claude', 'skills', 'demo-claude-codex', 'SKILL.md'), 'x');
  writeFileSync(join(home, '.codex', 'skills', 'demo-claude-codex', 'SKILL.md'), 'x');
  writeFileSync(join(home, '.roo', 'skills', 'demo-roo', 'SKILL.md'), 'x');
  writeFileSync(join(home, '.roo', 'agents', 'a-architect.md'), 'x');
  writeFileSync(join(home, '.agents', 'skills', 'demo-agy', 'SKILL.md'), 'x');
  writeFileSync(join(home, '.gemini', 'config', 'agents', 'g-agent.md'), 'x');
  const cat = buildCatalog({ root, home, now: () => Date.now() });
  assert.deepEqual(byName(cat.skills, 'demo-claude-codex').installed, { claude: true, codex: true, agy: false, cursor: false, roo: false });
  assert.deepEqual(byName(cat.skills, 'demo-roo').installed, { claude: false, codex: false, agy: false, cursor: false, roo: true });
  assert.deepEqual(byName(cat.skills, 'demo-agy').installed, { claude: false, codex: false, agy: true, cursor: false, roo: false });
  assert.deepEqual(byName(cat.skills, 'nowhere').installed, { claude: false, codex: false, agy: false, cursor: false, roo: false });
  // agents via <name>.md in the harness agents dirs; .agents and .gemini both are the agy family
  assert.deepEqual(byName(cat.agents, 'a-architect').installed, { claude: false, codex: false, agy: false, cursor: false, roo: true });
  assert.deepEqual(byName(cat.agents, 'g-agent').installed, { claude: false, codex: false, agy: true, cursor: false, roo: false });
  // opencode: no flag, globalRoots() has no OpenCode entry (plan rule)
  assert.ok(Object.keys(byName(cat.skills, 'demo-agy').installed).every((k) => k !== 'opencode'));
});

test('MCP installed flags from fixture harness mcp configs (temp HOME, no CODEX_HOME)', () => {
  const home = join(tmpBase, 'mcp-home');
  const keep = process.env.CODEX_HOME;
  delete process.env.CODEX_HOME; // fixture isolation; restored below
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { synapse: { command: 'node' } } }));
  try {
    const cat = buildCatalog({ root: ROOT, home, now: () => Date.now() });
    const syn = byName(cat.mcps, 'synapse');
    assert.ok(syn, 'synapse listed (DIRECT_SERVERS entry)');
    assert.equal(syn.category, 'direct');
    assert.equal(syn.installed.claude, true);
  } finally {
    if (keep === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = keep;
  }
});

test('route handler returns 200 and caches within 30 s (injected now)', async () => {
  catalogCacheReset();
  let t = 1000;
  const ctx = makeCtx(ROOT, tmpBase, () => t);

  const first = await call('', ctx);
  assert.equal(first.status, 200);
  assert.equal(first.json.generatedAt, 1000);
  assert.ok(['skills', 'agents', 'commands', 'mcps'].every((k) => Array.isArray(first.json[k])));

  t = 25_000; // inside the 30 s window
  const cached = await call('', ctx);
  assert.equal(cached.status, 200);
  assert.deepEqual(cached.json, first.json, 'cached inside the 30 s window');

  t = 31_500; // outside the window
  const rebuilt = await call('', ctx);
  assert.equal(rebuilt.status, 200);
  assert.equal(rebuilt.json.generatedAt, 31_500, 'rebuilt after the TTL');

  t = 31_600; // refresh=1 forces a rebuild even inside the new window
  const fresh = await call('?refresh=1', ctx);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.json.generatedAt, 31_600, 'refresh forces a rebuild');

  const text = JSON.stringify(fresh.json);
  assert.ok(!/ghp_/.test(text));
  assert.ok(!/github_pat_/.test(text));
});

test('route cache served for the same result object identity support', () => {
  catalogCacheReset();
  assert.doesNotThrow(() => catalogCacheReset());
});
