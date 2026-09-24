#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = join(ROOT, 'lib', 'ecc-store-index.json');
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const project = args.includes('--project');
const positional = args.filter((arg) => !arg.startsWith('--'));
const option = (name) => args.find((arg) => arg === name || arg.startsWith(`${name}=`))?.split('=').slice(1).join('=');

function loadIndex() {
  if (!index.pinned_commit || !index.skills || !index.subagents) throw new Error('Invalid AOS store index');
  return index;
}

function allItems(type) {
  const selected = type === 'agents' || type === 'subagents' ? 'subagents' : 'skills';
  return Object.entries(index[selected] || {}).map(([name, item]) => ({ name, item, type: selected }));
}

function findItem(name) {
  for (const type of ['skills', 'subagents']) {
    if (index[type]?.[name]) return { name, item: index[type][name], type };
  }
  return null;
}

function localSkillNames() {
  const names = new Set();
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.name === 'SKILL.md') names.add(basename(dirname(fullPath)));
    }
  };
  visit(join(ROOT, 'skills'));
  return names;
}

function localAgentNames() {
  const names = new Set();
  for (const dir of [join(ROOT, '.claude', 'agents'), join(ROOT, '.agents', 'agents'), join(ROOT, 'agents')]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) names.add(entry.replace(/\.md$/i, ''));
  }
  return names;
}

function globalRoots(type) {
  const home = homedir();
  return type === 'skills'
    ? [
      join(home, '.agents', 'skills'),
      join(home, '.claude', 'skills'),
      join(home, '.codex', 'skills'),
      join(home, '.cursor', 'skills'),
      join(home, '.roo', 'skills'),
      join(home, '.gemini', 'config', 'skills'),
    ]
    : [
      join(home, '.agents', 'agents'),
      join(home, '.claude', 'agents'),
      join(home, '.codex', 'agents'),
      join(home, '.cursor', 'agents'),
      join(home, '.roo', 'agents'),
      join(home, '.gemini', 'config', 'agents'),
    ];
}

function printItems(items) {
  if (items.length === 0) {
    console.log('No store items found.');
    return;
  }
  for (const { name, item, type } of items) {
    const kind = type === 'skills' ? 'skill' : 'agent';
    console.log(`${kind}\t${name}\t${item.category}\t${item.description}`);
  }
  console.log(`\n${items.length} item(s).`);
}

async function download(upstreamPath) {
  const url = `https://raw.githubusercontent.com/affaan-m/ECC/${index.pinned_commit}/${upstreamPath}`;
  const response = await fetch(url, { headers: { 'user-agent': 'aos-store' } });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function targetsFor(type, name) {
  if (project) {
    return type === 'skills'
      ? [join(process.cwd(), 'skills', name, 'SKILL.md')]
      : [join(process.cwd(), 'agents', `${name}.md`)];
  }
  return globalRoots(type).map((root) => type === 'skills'
    ? join(root, name, 'SKILL.md')
    : join(root, `${name}.md`));
}

async function install(name) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Invalid store name: ${name}`);
  const found = findItem(name);
  if (!found) throw new Error(`Store item not found: ${name}`);
  const { item, type } = found;
  const coreNames = type === 'skills' ? localSkillNames() : localAgentNames();
  if (coreNames.has(name)) {
    console.log(`Skipped ${name}: AOS core already provides it.`);
    return;
  }
  const targets = targetsFor(type, name);
  if (dryRun) {
    for (const target of targets) console.log(`[dry-run] write ${target}`);
    return;
  }
  const content = await download(item.upstream_path);
  const digest = createHash('sha256').update(content).digest('hex');
  if (digest !== item.sha256) throw new Error(`SHA-256 mismatch for ${name}: expected ${item.sha256}, got ${digest}`);
  for (const target of targets) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    console.log(`Installed ${name} -> ${target}`);
  }
}

function usage() {
  console.log('Usage:');
  console.log('  aos store list [--type=skills|agents]');
  console.log('  aos store search <query>');
  console.log('  aos store install <name> [--project] [--dry-run]');
}

async function main() {
  loadIndex();
  const command = positional[0] || 'list';
  if (command === 'list') {
    printItems(allItems(option('--type') || 'skills'));
    return;
  }
  if (command === 'search') {
    const query = (positional[1] || '').toLowerCase();
    if (!query) throw new Error('Search requires a query.');
    const items = allItems(option('--type') || '').filter(({ name, item }) => `${name} ${item.description} ${item.category}`.toLowerCase().includes(query));
    printItems(items);
    return;
  }
  if (command === 'install') {
    if (!positional[1]) throw new Error('Install requires a store item name.');
    await install(positional[1]);
    return;
  }
  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`aos store: ${error.message}`);
  process.exitCode = 1;
});
