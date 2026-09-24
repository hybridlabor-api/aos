#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(ROOT, '.agents', 'vendor-manifest.json');
const OUTPUT_PATH = join(ROOT, 'lib', 'ecc-store-index.json');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const entry = manifest.vendors?.['ecc-store'];
if (!entry?.pinned_commit || !/^[a-f0-9]{40}$/.test(entry.pinned_commit)) {
  throw new Error('Missing or invalid .agents/vendor-manifest.json ECC store pin');
}

const checkout = mkdtempSync(join(tmpdir(), 'aos-ecc-store-'));

function runGit(args) {
  return execFileSync('git', args, { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function walk(dir, output = []) {
  if (!existsSync(dir)) return output;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, item.name);
    if (item.isDirectory()) walk(fullPath, output);
    else if (item.isFile()) output.push(fullPath);
  }
  return output;
}

function frontmatterValue(text, key) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return '';
  const lines = match[1].split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${key}:`, 'i').test(line));
  if (start < 0) return '';
  const first = lines[start].slice(lines[start].indexOf(':') + 1).trim();
  if (first && !/^[>|][-+]?$/.test(first)) return first.replace(/^['"]|['"]$/g, '');
  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && !/^\s/.test(line)) break;
    values.push(line.trim());
  }
  return values.join(' ').trim();
}

function categoryFor(name) {
  const value = name.toLowerCase();
  if (/(media|video|motion|3d|blender|manim|creative|remotion|comfy)/.test(value)) return 'media-eventtech';
  if (/(design|frontend|react|vue|angular|next|tailwind|ui-|uiux|brand)/.test(value) || /(^|-)ui($|-)/.test(value)) return 'design-ui-ux';
  if (/(agent|pipeline|orchestr|autonom|benchmark|eval|security|skill|workflow)/.test(value)) return 'bdb-core';
  if (/(hardware|pcb|circuit|electronic)/.test(value)) return 'engineering-hardware';
  if (/(engineering|architecture|database|api|devops|docker|kubernetes|python|pytorch|typescript|rust|golang|java|spring|django|fastapi|react|test|build|resolver|reviewer|performance)/.test(value)) return 'engineering-method';
  return 'library';
}

function compatibilityWarnings(text) {
  const warnings = [];
  if (/\bBash\b/.test(text)) warnings.push('mentions Bash');
  if (/\bView\b/.test(text)) warnings.push('mentions View');
  return warnings;
}

function localNames() {
  const names = new Set();
  for (const file of walk(join(ROOT, 'skills'))) {
    if (basename(file) === 'SKILL.md') {
      const text = readFileSync(file, 'utf8');
      names.add((frontmatterValue(text, 'name') || basename(dirname(file))).trim().toLowerCase());
    }
  }
  for (const root of [join(ROOT, '.claude', 'agents'), join(ROOT, '.agents', 'agents'), join(ROOT, 'agents')]) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) names.add(name.replace(/\.md$/i, '').toLowerCase());
  }
  return names;
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function itemFromFile(file, type) {
  const content = readFileSync(file, 'utf8');
  const name = type === 'skills'
    ? (frontmatterValue(content, 'name') || basename(dirname(file))).trim()
    : basename(file, '.md');
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Invalid store name: ${name}`);
  const description = (frontmatterValue(content, 'description') || type).replace(/\s+/g, ' ').trim();
  const shortDescription = description.length > 32 ? `${description.slice(0, 31)}…` : description;
  const base = {
    description: shortDescription,
    category: categoryFor(name),
    tier: 'free',
    origin: 'ecc',
    requires_auth: false,
    sha256: hash(content),
    upstream_path: relative(checkout, file).split(sep).join('/'),
  };
  return { name, item: base, warnings: compatibilityWarnings(content) };
}

try {
  runGit(['init', '--quiet']);
  runGit(['remote', 'add', 'origin', entry.upstream]);
  runGit(['fetch', '--quiet', '--depth=1', 'origin', entry.pinned_commit]);
  runGit(['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
  const generatedAt = runGit(['show', '-s', '--format=%cI', 'FETCH_HEAD']);
  const coreNames = localNames();
  const skills = {};
  const subagents = {};
  let compatibilityWarningCount = 0;
  const skillFiles = walk(join(checkout, 'skills')).filter((file) => basename(file) === 'SKILL.md');
  const agentFiles = walk(join(checkout, 'agents')).filter((file) => file.endsWith('.md'));
  for (const file of skillFiles) {
    const { name, item, warnings } = itemFromFile(file, 'skills');
    compatibilityWarningCount += warnings.length;
    if (coreNames.has(name.toLowerCase())) continue;
    skills[name] = item;
  }
  for (const file of agentFiles) {
    const { name, item, warnings } = itemFromFile(file, 'subagents');
    compatibilityWarningCount += warnings.length;
    if (coreNames.has(name.toLowerCase())) continue;
    subagents[name] = item;
  }
  const index = {
    version: '1.0.0',
    generated_at: generatedAt,
    pinned_commit: entry.pinned_commit,
    harness_support: ['claude', 'antigravity', 'codex', 'cursor', 'roo'],
    compatibility_warning_count: compatibilityWarningCount,
    skills: Object.fromEntries(Object.entries(skills).sort(([a], [b]) => a.localeCompare(b))),
    subagents: Object.fromEntries(Object.entries(subagents).sort(([a], [b]) => a.localeCompare(b))),
  };
  const output = JSON.stringify(index) + '\n';
  if (Buffer.byteLength(output) >= 100 * 1024) throw new Error(`Store index exceeds 100 KB: ${Buffer.byteLength(output)} bytes`);
  writeFileSync(OUTPUT_PATH, output);
  console.log(`Wrote ${OUTPUT_PATH} with ${Object.keys(skills).length} skills and ${Object.keys(subagents).length} subagents (${Buffer.byteLength(output)} bytes).`);
} finally {
  rmSync(checkout, { recursive: true, force: true });
}
