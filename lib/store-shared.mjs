import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

export const MAX_FILES = 200;
export const MAX_BYTES = 5 * 1024 * 1024;

function safeRel(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || /[\\\0]/.test(path)
    || path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new Error(`Unsafe file path in store index: ${JSON.stringify(path)}`);
  }
}

export function validateFiles(files) {
  if (files.length > MAX_FILES) throw new Error(`Too many files (${files.length} > ${MAX_FILES})`);
  let total = 0;
  const seen = new Set();
  for (const f of files) {
    safeRel(f.path);
    if (seen.has(f.path)) throw new Error(`Duplicate file path: ${f.path}`);
    seen.add(f.path);
    if (f.size !== undefined) {
      if (!Number.isInteger(f.size) || f.size < 0) throw new Error(`Invalid size for ${f.path}`);
      total += f.size;
    }
  }
  if (total > MAX_BYTES) throw new Error(`Skill too large (${total} > ${MAX_BYTES} bytes)`);
  return files;
}

// True when every file of the item exists (size checked when the index has it); no hashing.
export function isInstalled(type, name, item, opts) {
  const targets = targetsFor(type, name, opts);
  if (type !== 'skills' || !(item.files?.length > 1)) return targets.every(existsSync);
  return targets.every((t) => fileTargets(t, item.files).every((p, i) => {
    try { const st = statSync(p); return st.isFile() && st.size === item.files[i].size; } catch { return false; }
  }));
}

export const fileTargets = (skillMd, files) => files.map((f) => join(dirname(skillMd), ...f.path.split('/')));

// Downloads and verifies everything in memory; nothing touches disk.
export async function fetchSkillFiles(rawBase, commit, upstreamDir, files) {
  validateFiles(files);
  const out = [];
  let total = 0;
  for (const f of files) {
    const url = `${rawBase}/${commit}/${upstreamDir}/${f.path}`;
    const res = await fetch(url, { headers: { 'user-agent': 'aos-store' } });
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    const data = Buffer.from(await res.arrayBuffer());
    total += data.length;
    if (total > MAX_BYTES) throw new Error(`Skill too large (> ${MAX_BYTES} bytes)`);
    if (f.size !== undefined && data.length !== f.size) throw new Error(`Size mismatch for ${f.path}: expected ${f.size}, got ${data.length}`);
    const digest = createHash('sha256').update(data).digest('hex');
    if (digest !== f.sha256) throw new Error(`SHA-256 mismatch for ${f.path}: expected ${f.sha256}, got ${digest}`);
    out.push({ ...f, data });
  }
  return out;
}

function assertNoSymlink(path) {
  try { if (lstatSync(path).isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${path}`); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}

// Checks every destination; throws on an unsafe path and touches nothing.
export function planSkillFiles(skillMd, files) {
  const dir = resolve(dirname(skillMd));
  return files.map((f) => {
    safeRel(f.path);
    const dest = resolve(dir, ...f.path.split('/'));
    if (!dest.startsWith(dir + sep)) throw new Error(`Path escapes skill dir: ${f.path}`);
    for (let p = dest; p !== dir; p = dirname(p)) assertNoSymlink(p);
    assertNoSymlink(dir);
    return { ...f, dest };
  });
}

export function writePlan(plan) {
  for (const f of plan) {
    mkdirSync(dirname(f.dest), { recursive: true });
    writeFileSync(f.dest, f.data);
    if (f.exec) chmodSync(f.dest, 0o755);
  }
  return plan.map((f) => f.dest);
}

export const writeSkillFiles = (skillMd, files) => writePlan(planSkillFiles(skillMd, files));

const RAW_BASE_RE = /^https:\/\/raw\.githubusercontent\.com\/[\w.-]+\/[\w.-]+$/;
const ECC_SOURCE = {
  id: 'ecc', label: 'ECC', raw_base: 'https://raw.githubusercontent.com/affaan-m/ECC',
  license: 'MIT', copyright: 'Copyright (c) 2026 Affaan Mustafa', third_party: true,
};

// Test overrides: AOS_STORE_INDEX / AOS_STORE_RAW_BASE (ECC), AOS_STORE_INDEX_SCENARIO / AOS_STORE_RAW_BASE_SCENARIO (Scenario).
export function loadSources(root, env = process.env) {
  const specs = [
    { file: env.AOS_STORE_INDEX || join(root, 'lib', 'ecc-store-index.json'), base: env.AOS_STORE_RAW_BASE, fallback: ECC_SOURCE },
    { file: env.AOS_STORE_INDEX_SCENARIO || join(root, 'lib', 'scenario-store-index.json'), base: env.AOS_STORE_RAW_BASE_SCENARIO },
  ];
  return specs.map(({ file, base, fallback }) => {
    const index = JSON.parse(readFileSync(file, 'utf8'));
    if (!index.pinned_commit || !index.skills || !index.subagents) throw new Error(`Invalid AOS store index: ${file}`);
    const meta = { ...fallback, ...index.source };
    if (!meta.id || !meta.label) throw new Error(`Store index has no source descriptor: ${file}`);
    if (!base && !RAW_BASE_RE.test(meta.raw_base || '')) throw new Error(`Untrusted raw_base in ${file}: ${meta.raw_base}`);
    return { ...meta, raw_base: (base || meta.raw_base).replace(/\/+$/, ''), pinned_commit: index.pinned_commit, index };
  });
}

export function findItems(sources, name) {
  const found = [];
  for (const src of sources) {
    for (const type of ['skills', 'subagents']) {
      if (src.index[type]?.[name]) found.push({ name, item: src.index[type][name], type, src });
    }
  }
  return found;
}

export function findItem(sources, name) {
  const found = findItems(sources, name);
  if (found.length > 1) {
    throw new Error(`Name collision: '${name}' exists in ${found.map((f) => f.src.label).join(' and ')}; refusing to pick one or overwrite`);
  }
  return found[0] || null;
}

// The item plus the skills it requires (same source), dependencies first.
export function installPlan(sources, found) {
  const plan = [];
  const visit = (entry, chain) => {
    if (chain.includes(entry.name)) throw new Error(`Circular requires: ${[...chain, entry.name].join(' -> ')}`);
    for (const dep of entry.item.requires || []) {
      const hit = findItem(sources, dep);
      if (!hit || hit.src !== entry.src || hit.type !== 'skills') throw new Error(`${entry.name} requires '${dep}', which is not available in ${entry.src.label}`);
      visit(hit, [...chain, entry.name]);
    }
    if (!plan.some((p) => p.name === entry.name)) plan.push(entry);
  };
  visit(found, []);
  return plan;
}

export function planSummary(plan) {
  const all = plan.flatMap((p) => (p.item.files || []).map((f) => ({ ...f, skill: p.name })));
  const bridge = plan.flatMap((p) => (p.item.execBridgeFiles || []).map((f) => ({ skill: p.name, ...f })));
  return {
    skills: plan.map((p) => p.name),
    requires: plan.slice(0, -1).map((p) => p.name),
    fileCount: all.length || plan.length,
    totalSize: all.reduce((n, f) => n + f.size, 0),
    scriptCount: plan.reduce((n, p) => n + (p.item.scriptCount || 0), 0),
    hasScripts: plan.some((p) => p.item.hasScripts),
    execBridge: plan.some((p) => p.item.execBridge),
    execBridgeFiles: bridge,
    software: [...new Set(plan.flatMap((p) => p.item.software || []))],
  };
}

export function localSkills(root) {
  const found = new Map();
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.name === 'SKILL.md') found.set(basename(dirname(fullPath)), fullPath);
    }
  };
  visit(join(root, 'skills'));
  return found;
}

export function localAgents(root) {
  const found = new Map();
  for (const dir of [join(root, '.claude', 'agents'), join(root, '.agents', 'agents'), join(root, 'agents')]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) found.set(entry.replace(/\.md$/i, ''), join(dir, entry));
  }
  return found;
}

export function globalRoots(type) {
  const home = homedir();
  const sub = type === 'skills' ? 'skills' : 'agents';
  return [
    join(home, '.agents', sub),
    join(home, '.claude', sub),
    join(home, '.codex', sub),
    join(home, '.cursor', sub),
    join(home, '.roo', sub),
    join(home, '.gemini', 'config', sub),
  ];
}

export function targetsFor(type, name, { project = false, cwd = process.cwd() } = {}) {
  if (project) {
    return type === 'skills'
      ? [join(cwd, 'skills', name, 'SKILL.md')]
      : [join(cwd, 'agents', `${name}.md`)];
  }
  return globalRoots(type).map((root) => (type === 'skills'
    ? join(root, name, 'SKILL.md')
    : join(root, `${name}.md`)));
}
