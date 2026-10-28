#!/usr/bin/env node

import '../lib/cli-help-guard.mjs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BYTES, aosInstalledExact, fetchSkillFiles, readAosFiles, fileTargets, findItem, installPlan, installWithBackup, appendInstallLog, loadSources, localAgents, localSkills, planSkillFiles, planSummary, rankSearch, rollbackInstall, targetsFor as sharedTargetsFor, validateFiles } from '../lib/store-shared.mjs';
import { installPack, removePack, packOverview, knownPack, packSkillNames } from '../lib/store-packs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = loadSources(ROOT, process.env, { withAos: true });
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const project = args.includes('--project');
const net = args.includes('--net');
const positional = args.filter((arg) => !arg.startsWith('--'));
const option = (name) => args.find((arg) => arg === name || arg.startsWith(`${name}=`))?.split('=').slice(1).join('=');
// `--name=value` or `--name value` (the next argument, unless it is another flag).
const optionValue = (name) => {
  const i = args.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (i < 0) return undefined;
  if (args[i] !== name) return args[i].slice(name.length + 1);
  const next = args[i + 1];
  return next !== undefined && !next.startsWith('--') ? next : '';
};

// The local aos source is listed only on request: --source=aos (or all). install always sees it.
function allItems(type, { includeLocal = false } = {}) {
  const selected = type === 'agents' || type === 'subagents' ? 'subagents' : 'skills';
  const want = option('--source');
  const visible = want === 'all' ? sources : sources.filter((src) => (want ? src.id === want : includeLocal || !src.local));
  if (want && want !== 'all' && !visible.length) throw new Error(`Unknown source: ${want} (${sources.map((s) => s.id).join(', ')}, all)`);
  return visible.flatMap((src) => Object.entries(src.index[selected] || {}).map(([name, item]) => ({ name, item, type: selected, src })));
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
  // Reject an oversized transfer BEFORE any body bytes are buffered.
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error(`Download too large (${declared} > ${MAX_BYTES} bytes): ${url}`);
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        try { reader.cancel(); } catch { /* already closed */ }
        throw new Error(`Item too large (> ${MAX_BYTES} bytes): ${url}`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  const content = Buffer.from(await response.arrayBuffer());
  if (content.length > MAX_BYTES) throw new Error(`Item too large (> ${MAX_BYTES} bytes): ${url}`);
  return content;
}

const targetsFor = (type, name) => sharedTargetsFor(type, name, { project });

async function install(name) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Invalid store name: ${name}`);
  const found = findItem(sources, name);
  if (!found) throw new Error(`Store item not found: ${name}`);
  const { type, src } = found;
  const coreNames = type === 'skills' ? localSkillNames() : localAgentNames();
  if (!src.local && coreNames.has(name)) {
    console.log(`Skipped ${name}: AOS core already provides it.`);
    return;
  }
  const plan = installPlan(sources, found).filter((p) => p.src.local || !(p.type === 'skills' && p.name !== name && localSkillNames().has(p.name)));
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
  if (!net && !src.local) {
    throw new Error(`Downloading '${name}' requires internet access to fetch from upstream GitHub. Pass --net to confirm: aos store install ${name} --net`);
  }
  // All-or-nothing: download, hash-check and path-check every skill in memory before the first write.
  const writes = [];
  for (const p of plan) {
    const pSrc = p.src;
    let files;
    if (pSrc.local) {
      files = readAosFiles(p.item);
    } else if (multi(p)) {
      files = await fetchSkillFiles(pSrc.raw_base, pSrc.pinned_commit, dirname(p.item.upstream_path), p.item.files);
    } else {
      const content = await download(pSrc, p.item.upstream_path);
      if (content.length > MAX_BYTES) throw new Error(`Item too large (> ${MAX_BYTES} bytes)`);
      const digest = createHash('sha256').update(content).digest('hex');
      if (digest !== p.item.sha256) throw new Error(`SHA-256 mismatch for ${p.name}: expected ${p.item.sha256}, got ${digest}`);
      files = null;
      for (const target of targetsFor(p.type, p.name)) writes.push({ type: 'file', target, data: content, item: p.item });
    }
    if (files) for (const target of targetsFor(p.type, p.name)) writes.push({ type: 'dir', target, plan: planSkillFiles(target, files), item: p.item });
  }
  for (const note of notes) console.log(note);
  if (src.local) {
    const todo = writes.filter((w) => !aosInstalledExact(w.item, w.target));
    if (!todo.length) { console.log(`Already installed: ${name}`); return; }
    writes.splice(0, writes.length, ...todo);
  }
  const home = homedir();
  const written = installWithBackup({ writes, home });
  const kind = found.type === 'skills' ? 'skill' : 'agent';
  appendInstallLog(home, {
    ts: new Date().toISOString(),
    name,
    kind,
    source: found.src.id,
    ...(found.src.local ? { from: found.src.from || 'package' } : {}),
    commit: found.src.pinned_commit,
    scope: project ? 'project' : 'global',
    targets: written.targets,
    disks: written.disks,
    backups: written.backups,
  });
  for (const w of writes) {
    if (w.type === 'file') {
      console.log(`Installed ${name} -> ${w.target}`);
    } else {
      console.log(`Installed ${name} (${w.plan.length} files) -> ${dirname(w.target)}`);
    }
  }
}

// Installs a whole pack offline from the local library (~/.aos/library), falling back to the
// package copy. Skill-level results are printed per skill; the pack name rides in the log.
async function installPackCommand(name) {
  if (!knownPack(name)) {
    throw new Error(`Unknown pack: ${name}. Known: ${packOverview().map((p) => p.name).join(', ') || '(none)'}. Run: aos store packs`);
  }
  const { installed, skipped } = installPack(name, { project, dryRun });
  for (const s of skipped) console.log(`Skipped ${s.name}: ${s.reason}`);
  for (const s of installed) console.log(`Installed ${s} (pack ${name})`);
  console.log(`Pack ${name}: ${installed.length} installed, ${skipped.length} skipped${dryRun ? ' (dry-run)' : ''}.`);
  const missing = skipped.filter((s) => /not found in the local library/.test(s.reason)).map((s) => s.name);
  if (missing.length) {
    console.log(`Not shipped offline (need a network install, e.g. aos store install <name> --net, or the pack's installer module): ${missing.join(', ')}`);
  }
}

function removePackCommand(name) {
  if (!knownPack(name)) {
    throw new Error(`Unknown pack: ${name}. Known: ${packOverview().map((p) => p.name).join(', ') || '(none)'}. Run: aos store packs`);
  }
  const { removed, kept } = removePack(name, { project, dryRun });
  for (const k of kept) console.log(`Kept ${k.name}: ${k.reason}`);
  for (const r of removed) console.log(`Removed ${r.name} -> parked at ${r.backup}`);
  console.log(`Pack ${name}: ${removed.length} dir(s) removed, ${kept.length} kept${dryRun ? ' (dry-run)' : ''}.`);
  if (!dryRun && removed.length) console.log('Restore by reinstalling the pack or the skill (aos store install ...); the parked copy is not deleted.');
}

function rollback(name) {
  if (!name) throw new Error('Rollback requires a store item name.');
  const res = rollbackInstall({ name, home: homedir(), project, cwd: process.cwd() });
  console.log(`Rolled back ${res.name}: ${res.restored} target(s) restored from .aos-bak-* backups.`);
  for (const p of res.parked) console.log(`Previous state parked (not deleted): ${p}`);
}

function usage() {
  console.log('Usage:');
  console.log('  aos store list [--type=skills|agents] [--source=ecc|scenario|aos|all]');
  console.log('  aos store search <query> [--source=...]');
  console.log('  aos store install <name> [--project] [--dry-run] [--net]');
  console.log('  aos store install --pack <name> [--project] [--dry-run]   offline, from ~/.aos/library');
  console.log('  aos store remove --pack <name> [--project] [--dry-run]');
  console.log('  aos store packs                                          list packs');
  console.log('  aos store rollback <name> [--project]');
  console.log('  aos store ui [--port=N] [--no-open]');
}

async function main() {
  const command = positional[0] || 'list';
  if (command === 'list') {
    printItems(allItems(option('--type') || 'skills'));
    return;
  }
  if (command === 'packs') {
    const rows = packOverview();
    if (!rows.length) { console.log('No packs defined.'); return; }
    for (const p of rows) console.log(`pack\t${p.name}\t${p.skills} skill(s)${p.external ? '\texternal' : ''}\t${p.description}`);
    console.log(`\n${rows.length} pack(s). Install: aos store install --pack <name>`);
    return;
  }
  if (command === 'search') {
    if (!positional.slice(1).join(' ').trim()) throw new Error('Search requires a query.');
    const items = rankSearch(allItems(option('--type') || '', { includeLocal: true }), positional.slice(1).join(' '));
    printItems(items);
    return;
  }
  if (command === 'ui') {
    const { startUi } = await import('../lib/store-ui/server.mjs');
    await startUi({ argv: args });
    return;
  }
  if (command === 'install') {
    const packs = args.flatMap((arg, i) => {
      if (arg === '--pack') return [args[i + 1]].filter(Boolean);
      if (arg.startsWith('--pack=')) return [arg.slice(7)].filter(Boolean);
      return [];
    });
    if (args.includes('--pack') && !packs.length) throw new Error('--pack needs a value: aos store install --pack <name>');
    if (packs.length) {
      for (const pack of packs) {
        await installPackCommand(pack);
      }
      return;
    }
    const names = positional.slice(1);
    if (!names.length) throw new Error('Install requires a store item name.');
    for (const name of names) {
      await install(name);
    }
    return;
  }
  if (command === 'remove') {
    const pack = optionValue('--pack');
    if (pack === undefined) throw new Error('Remove currently supports packs only: aos store remove --pack <name>');
    if (!pack) throw new Error('--pack needs a value: aos store remove --pack <name>');
    removePackCommand(pack);
    return;
  }
  if (command === 'rollback') {
    rollback(positional[1]);
    return;
  }
  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`aos store: ${error.message}`);
  process.exitCode = 1;
});
