#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSkillFiles, fileTargets, findItem, installPlan, loadSources, localAgents, localSkills, planSkillFiles, planSummary, targetsFor as sharedTargetsFor, validateFiles, writePlan } from '../lib/store-shared.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = loadSources(ROOT);
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const project = args.includes('--project');
const net = args.includes('--net');
const positional = args.filter((arg) => !arg.startsWith('--'));
const option = (name) => args.find((arg) => arg === name || arg.startsWith(`${name}=`))?.split('=').slice(1).join('=');

function allItems(type) {
  const selected = type === 'agents' || type === 'subagents' ? 'subagents' : 'skills';
  return sources.flatMap((src) => Object.entries(src.index[selected] || {}).map(([name, item]) => ({ name, item, type: selected, src })));
}

const localSkillNames = () => new Set(localSkills(ROOT).keys());
const localAgentNames = () => new Set(localAgents(ROOT).keys());

function printItems(items) {
  if (items.length === 0) {
    console.log('No store items found.');
    return;
  }
  for (const { name, item, type, src } of items) {
    const kind = type === 'skills' ? 'skill' : 'agent';
    console.log(`${kind}\t${name}\t${item.category}\t${src.label}\t${item.description}`);
  }
  console.log(`\n${items.length} item(s).`);
}

async function download(src, upstreamPath) {
  const url = `${src.raw_base}/${src.pinned_commit}/${upstreamPath}`;
  const response = await fetch(url, { headers: { 'user-agent': 'aos-store' } });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

const targetsFor = (type, name) => sharedTargetsFor(type, name, { project });

async function install(name) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Invalid store name: ${name}`);
  const found = findItem(sources, name);
  if (!found) throw new Error(`Store item not found: ${name}`);
  const { type, src } = found;
  const coreNames = type === 'skills' ? localSkillNames() : localAgentNames();
  if (coreNames.has(name)) {
    console.log(`Skipped ${name}: AOS core already provides it.`);
    return;
  }
  const plan = installPlan(sources, found).filter((p) => !(p.type === 'skills' && p.name !== name && localSkillNames().has(p.name)));
  for (const p of plan) if (p.item.files?.length > 1) validateFiles(p.item.files);
  const multi = (p) => p.type === 'skills' && p.item.files?.length > 1;
  const summary = planSummary(plan);
  const notes = [];
  if (summary.requires.length) notes.push(`also installs required skill(s): ${summary.requires.join(', ')}`);
  if (summary.execBridge) notes.push(`WARNING: contains a script that executes code received over a local socket or file channel without authentication (${summary.execBridgeFiles.map((f) => `${f.skill}/${f.path}`).join(', ')}); install only if you use this bridge`);
  else if (summary.hasScripts) notes.push(`WARNING: contains ${summary.scriptCount} script file(s); review before use`);
  if (dryRun) {
    for (const note of notes) console.log(note);
    for (const p of plan) {
      for (const target of targetsFor(p.type, p.name)) {
        if (multi(p)) for (const file of fileTargets(target, p.item.files)) console.log(`[dry-run] write ${file}`);
        else console.log(`[dry-run] write ${target}`);
      }
    }
    return;
  }
  if (!net) {
    throw new Error(`Downloading '${name}' requires internet access to fetch from upstream GitHub. Pass --net to confirm: aos store install ${name} --net`);
  }
  // All-or-nothing: download, hash-check and path-check every skill in memory before the first write.
  const writes = [];
  for (const p of plan) {
    const pSrc = p.src;
    let files;
    if (multi(p)) {
      files = await fetchSkillFiles(pSrc.raw_base, pSrc.pinned_commit, dirname(p.item.upstream_path), p.item.files);
    } else {
      const content = await download(pSrc, p.item.upstream_path);
      const digest = createHash('sha256').update(content).digest('hex');
      if (digest !== p.item.sha256) throw new Error(`SHA-256 mismatch for ${p.name}: expected ${p.item.sha256}, got ${digest}`);
      files = null;
      for (const target of targetsFor(p.type, p.name)) writes.push({ name: p.name, single: { target, content } });
    }
    if (files) for (const target of targetsFor(p.type, p.name)) writes.push({ name: p.name, target, plan: planSkillFiles(target, files) });
  }
  for (const note of notes) console.log(note);
  for (const w of writes) {
    if (w.single) {
      mkdirSync(dirname(w.single.target), { recursive: true });
      writeFileSync(w.single.target, w.single.content);
      console.log(`Installed ${w.name} -> ${w.single.target}`);
    } else {
      console.log(`Installed ${w.name} (${writePlan(w.plan).length} files) -> ${dirname(w.target)}`);
    }
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
