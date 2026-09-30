import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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

// Checks every destination first, then writes; throws before any write on an unsafe path.
export function writeSkillFiles(skillMd, files) {
  const dir = resolve(dirname(skillMd));
  const plan = files.map((f) => {
    safeRel(f.path);
    const dest = resolve(dir, ...f.path.split('/'));
    if (!dest.startsWith(dir + sep)) throw new Error(`Path escapes skill dir: ${f.path}`);
    for (let p = dest; p !== dir; p = dirname(p)) assertNoSymlink(p);
    assertNoSymlink(dir);
    return { ...f, dest };
  });
  for (const f of plan) {
    mkdirSync(dirname(f.dest), { recursive: true });
    writeFileSync(f.dest, f.data);
    if (f.exec) chmodSync(f.dest, 0o755);
  }
  return plan.map((f) => f.dest);
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
