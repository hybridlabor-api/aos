import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// AOS runs on many harnesses (Claude Code, Antigravity/agy, OpenCode, Codex).
// A description may mention a harness only when that harness is genuinely one
// entry in an explicit list of supported peers, or when it names a product
// (claude.ai, the Claude model as a search engine). It must NOT use a single
// harness as the assumed environment for a harness-agnostic skill.
//
// `changed` descriptions were rewritten from an assumed single harness to "agent
// session"/"harness session". They must stay free of the word "Claude".
// `allowlist` descriptions legitimately name Claude/Claude Code, each with the
// reason it is not an assumption about the running harness.

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

const CLAUDE = /Claude/i;

// Descriptions that were neutralised: an assumed harness became "agent session".
const changed = [
  'skills/basic/master-session/SKILL.md',
  'skills/bdb-aos/SKILL.md',
  'skills/workspace_agents/firecrawl/SKILL.md',
  'skills/global_config/plan-arbiter/SKILL.md',
  'commands/mastersession.md',
  '.opencode/commands/bdb-aos-mastersession.md',
  'plugins/bdb-aos-codex/skills/mastersession/SKILL.md',
];

// Descriptions that may name Claude/Claude Code, keyed by identifier.
// reason: why the mention is legitimate and not an assumption about the harness.
const allowlist = {
  'teamwork-preview': 'Claude Code is one of six harnesses in an explicit supported-harness list',
  'subagent-setup': 'Claude Code is one of four harnesses the skill configures subagents for',
  'aos-a2a': 'Claude Code is one of four A2A peer kinds the skill lists',
  'pb-master': 'Claude Code is one of three spawnable worker harnesses named explicitly',
  'web-artifacts-builder': 'claude.ai is a product name, not the running harness',
  'geo-fundamentals': 'Claude is named as one AI search engine among several',
};

function frontmatter(src) {
  if (!src.startsWith('---')) return null;
  const end = src.indexOf('\n---', 3);
  return end === -1 ? null : src.slice(3, end);
}

// Extracts the `description` scalar from frontmatter, inline, quoted or block.
function descriptionOf(src) {
  const fm = frontmatter(src);
  if (fm === null) return null;
  const lines = fm.split('\n');
  const start = lines.findIndex((l) => /^description:/.test(l));
  if (start === -1) return null;
  const value = lines[start].replace(/^description:\s*/, '');
  const parts = value.length > 0 ? [value] : [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^[A-Za-z0-9_-]+:/.test(lines[i])) break;
    parts.push(lines[i]);
  }
  let text = parts.join(' ').replace(/\s+/g, ' ').trim();
  // Drop one layer of surrounding quotes from a quoted single-line scalar.
  const quoted = text.match(/^(["'])([\s\S]*)\1$/);
  if (quoted) text = quoted[2];
  return text;
}

function walkSkillFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walkSkillFiles(full, out);
    else if (e.name === 'SKILL.md') out.push(full);
  }
  return out;
}

// Every description location in scope, as { id, file, description }.
function collect() {
  const found = [];
  const seen = new Set();
  const add = (id, file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const desc = descriptionOf(readFileSync(file, 'utf8'));
    if (desc !== null) found.push({ id, file, description: desc });
  };

  for (const file of walkSkillFiles(join(repo, 'skills'))) add(basename(dirname(file)), file);

  const pluginDir = join(repo, 'plugins');
  if (existsSync(pluginDir)) {
    for (const e of readdirSync(pluginDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      for (const file of walkSkillFiles(join(pluginDir, e.name, 'skills'))) {
        add(`${e.name}:${basename(dirname(file))}`, file);
      }
    }
  }

  const commandsDir = join(repo, 'commands');
  if (existsSync(commandsDir)) {
    for (const e of readdirSync(commandsDir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.md')) add(basename(e.name, '.md'), join(commandsDir, e.name));
    }
  }

  const ocDir = join(repo, '.opencode', 'commands');
  if (existsSync(ocDir)) {
    for (const e of readdirSync(ocDir, { withFileTypes: true })) {
      if (e.isFile() && /^bdb-aos-.+\.md$/.test(e.name)) {
        add(e.name.replace(/^bdb-aos-/, '').replace(/\.md$/, ''), join(ocDir, e.name));
      }
    }
  }

  return found;
}

const descriptions = collect();

test('neutralised descriptions no longer mention Claude', () => {
  for (const rel of changed) {
    const entry = descriptions.find((d) => relative(repo, d.file) === rel);
    assert.ok(entry, `${rel} was not found or has no description`);
    assert.doesNotMatch(entry.description, CLAUDE, `${rel} still mentions Claude in its description`);
  }
});

test('the mastersession command source is neutral too', () => {
  const src = JSON.parse(readFileSync(join(repo, 'plugin-commands.json'), 'utf8'));
  assert.doesNotMatch(src.commands.mastersession.description, CLAUDE);
});

test('every description naming Claude is on the allowlist', () => {
  const offenders = descriptions
    .filter((d) => CLAUDE.test(d.description) && !(d.id in allowlist))
    .map((d) => `${relative(repo, d.file)} (${d.id})`);
  assert.deepEqual(offenders, []);
});

test('every allowlisted identifier exists and still names Claude', () => {
  for (const id of Object.keys(allowlist)) {
    assert.ok(descriptions.some((d) => d.id === id), `allowlist entry ${id} matches no description`);
  }
  const hits = descriptions.filter((d) => CLAUDE.test(d.description)).map((d) => d.id);
  for (const id of hits) assert.ok(id in allowlist, `${id} mentions Claude but is not allowlisted`);
});
