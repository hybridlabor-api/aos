import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import SPECS from '../lib/cli-specs/index.mjs';
import { buildOutputs } from '../scripts/build-cli-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

test('generated reference, AGENTS.md block and router table are up to date', () => {
  for (const { file, content } of buildOutputs()) {
    let current = '';
    try { current = read(file); } catch { /* missing */ }
    assert.equal(current, content, `${file} is stale: run node scripts/build-cli-reference.mjs`);
  }
});

test('every spec is complete', () => {
  for (const s of SPECS) {
    for (const k of ['name', 'entry', 'summary', 'whenToUse', 'agentSafe', 'sideEffects', 'json']) assert.ok(s[k], `${s.name}: ${k}`);
    assert.ok(['yes', 'caution', 'human-only'].includes(s.agentSafe), `${s.name}: agentSafe`);
    assert.ok(s.usage.length, `${s.name}: usage`);
    assert.ok(s.exit.length && s.exit.every((e) => e.meaning && e.code !== undefined), `${s.name}: exit`);
    for (const c of s.commands) assert.ok(c.name && c.usage && c.summary, `${s.name}: command ${c.name}`);
    for (const f of s.flags) assert.ok(f.name && f.summary, `${s.name}: flag ${f.name}`);
  }
});

// Spec -> code: every documented flag and command is a literal the CLI source parses.
const sourceOf = (s) => {
  const extra = { aos: ['lib/memory-import.js', 'lib/permissions-allow.js', 'lib/v5/menu.js'], 'aos-store': ['lib/store-ui/server.mjs'] }[s.name] || [];
  return [s.entry, ...extra].map(read).join('\n');
};
const bare = (w) => w.replace(/^-+/, '');
const flagWords = (f) => f.name.split(',').map((x) => x.trim().split(/\s+/)[0]).filter((x) => x.startsWith('-'));
const present = (src, w) => src.includes(w) || new RegExp(`["'\`]${bare(w)}["'\`]|\\b${bare(w)}\\s*:`).test(src);

for (const s of SPECS) {
  test(`${s.name}: spec flags and commands exist in the code`, () => {
    const src = sourceOf(s);
    for (const f of s.flags) for (const w of flagWords(f)) assert.ok(present(src, w), `${s.name}: flag ${w} not found in ${s.entry}`);
    for (const c of s.commands) assert.ok(present(src, c.name), `${s.name}: command ${c.name} not found in ${s.entry}`);
  });
}

// Code -> spec for CLIs with a flat flag parser: a literal flag in the source must be documented.
const REVERSE = {
  'aos-acp': ['--dangerously-skip-permissions', '--mode', '--output-format', '--print', '--help', '-c', '-y', '-h'],
  'aos-sessions': ['--help', '-h'],
  'aos-team': ['--help', '-h'],
  'aos-go-ref': [],
  'aos-hub': ['-o', '-p'],
  'aos-mcp-env': [],
  'go-check': ['--help', '-h'],
  'aos-gogate': ['--help', '-h', '--status'],
};
for (const [name, ignore] of Object.entries(REVERSE)) {
  test(`${name}: every flag literal in the code is documented in the spec`, () => {
    const s = SPECS.find((x) => x.name === name);
    const documented = new Set(s.flags.flatMap(flagWords));
    const found = new Set([...read(s.entry).matchAll(/["'`](--?[a-zA-Z][a-zA-Z-]*)["'`=]/g)].map((m) => m[1]));
    for (const w of found) if (!ignore.includes(w)) assert.ok(documented.has(w), `${name}: ${w} is parsed but not in lib/cli-specs`);
  });
}
