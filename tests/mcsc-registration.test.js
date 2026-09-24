/**
 * tests/mcsc-registration.test.js
 *
 * mcsc was previously invisible to AOS: no mcp_config.json entry (so it never
 * got installed as a callable MCP server), no SKILL.md (so no agent could
 * discover it via the skill listing). This asserts both are fixed.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

test('mcp_config.json registers mcsc pointing at its real server entry point', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'mcp_config.json'), 'utf8'));
  const entry = cfg.mcpServers.mcsc;
  assert.ok(entry, 'mcp_config.json has an "mcsc" entry under mcpServers');
  assert.strictEqual(entry.command, 'node');
  assert.ok(Array.isArray(entry.args) && entry.args[0] === '__MCPS_DIR__/mcsc/server.js', 'points at the real mcps/mcsc/server.js entry point');
  // the entry point this config references must actually exist in the repo
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'mcps', 'mcsc', 'server.js')), 'mcps/mcsc/server.js exists');
});

test('skills/global_config/mcsc/SKILL.md exists and is discoverable', () => {
  const p = path.join(REPO_ROOT, 'skills', 'global_config', 'mcsc', 'SKILL.md');
  assert.ok(fs.existsSync(p), 'SKILL.md was written for mcsc');
  const text = fs.readFileSync(p, 'utf8');
  assert.match(text, /^name:\s*mcsc\s*$/m);
  assert.match(text, /^category:\s*bdb-core\s*$/m);
});

test('AGENTS.md tells agents to prefer mcsc over shelling out to another CLI directly', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
  const section = text.slice(text.indexOf('## Delegating to an external CLI'));
  assert.match(section, /mcsc/, 'the delegation section mentions mcsc');
  const mcscIdx = section.search(/delegate through `mcsc`/);
  assert.ok(mcscIdx > -1 && mcscIdx < 400, 'mcsc is presented as the first-choice path near the top of the section, not buried after it');
});
