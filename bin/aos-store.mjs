#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSkillFiles, fileTargets, localAgents, localSkills, targetsFor as sharedTargetsFor, validateFiles, writeSkillFiles } from '../lib/store-shared.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = process.env.AOS_STORE_INDEX || join(ROOT, 'lib', 'ecc-store-index.json');
const RAW_BASE = (process.env.AOS_STORE_RAW_BASE || 'https://raw.githubusercontent.com/affaan-m/ECC').replace(/\/+$/, '');
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const project = args.includes('--project');
const net = args.includes('--net');
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

const localSkillNames = () => new Set(localSkills(ROOT).keys());
const localAgentNames = () => new Set(localAgents(ROOT).keys());

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
  const url = `${RAW_BASE}/${index.pinned_commit}/${upstreamPath}`;
  const response = await fetch(url, { headers: { 'user-agent': 'aos-store' } });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

const targetsFor = (type, name) => sharedTargetsFor(type, name, { project });

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
  const multi = type === 'skills' && item.files?.length > 1;
  if (multi) validateFiles(item.files);
  if (dryRun) {
    for (const target of targets) {
      if (multi) for (const file of fileTargets(target, item.files)) console.log(`[dry-run] write ${file}`);
      else console.log(`[dry-run] write ${target}`);
    }
    return;
  }
  if (!net) {
    throw new Error(`Downloading '${name}' requires internet access to fetch from upstream GitHub. Pass --net to confirm: aos store install ${name} --net`);
  }
  if (multi) {
    const files = await fetchSkillFiles(RAW_BASE, index.pinned_commit, dirname(item.upstream_path), item.files);
    for (const target of targets) {
      const written = writeSkillFiles(target, files);
      console.log(`Installed ${name} (${written.length} files) -> ${dirname(target)}`);
    }
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
  console.log('  aos store install <name> [--project] [--dry-run] [--net]');
  console.log('  aos store ui [--port=N] [--no-open]');
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
  if (command === 'ui') {
    const { startUi } = await import('../lib/store-ui/server.mjs');
    await startUi({ argv: args });
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
