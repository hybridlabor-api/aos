// Phantom-MCP regression test for godmode-media-creation.
// The skill used to reference two MCP servers that do not exist anywhere
// (openmontage_mcp, palmier_pro_mcp); it is CLI-first + verified-MCP now.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PHANTOM = /openmontage_mcp|palmier_pro_mcp/;

describe('godmode-media-creation phantom MCP regression', () => {
  it('skill file has no phantom MCP names', () => {
    const text = readFileSync(
      join(ROOT, 'skills', 'basic', 'godmode-media-creation', 'SKILL.md'), 'utf8',
    );
    assert.equal(PHANTOM.test(text), false, 'skill still references openmontage_mcp or palmier_pro_mcp');
  });

  it('eval case has no phantom MCP names', () => {
    const text = readFileSync(
      join(ROOT, 'tests', 'evals', 'cases', 'godmode-media-creation.json'), 'utf8',
    );
    assert.equal(PHANTOM.test(text), false, 'eval case still references openmontage_mcp or palmier_pro_mcp');
  });

  it('skill frontmatter parses with name and description', () => {
    const text = readFileSync(
      join(ROOT, 'skills', 'basic', 'godmode-media-creation', 'SKILL.md'), 'utf8',
    );
    assert.match(text, /^---\r?\n/);
    const fm = text.slice(4, text.indexOf('\n---', 4));
    const keys = new Map(fm.split('\n').filter((l) => /^\S/.test(l) && /^[A-Za-z_-]+:\s/.test(l)).map(
      (l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()],
    ));
    assert.equal(keys.get('name'), 'godmode-media-creation');
    const description = keys.get('description');
    assert.ok(description && description.length > 0, 'description must be non-empty');
  });
});
