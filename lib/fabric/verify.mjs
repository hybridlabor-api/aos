// A report is a proposal. This module checks it against reality: artifacts on disk, results the step kind needs,
// and the files that actually changed in the work tree (git), against the step's allowed_writes.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { GATE_KEYS } from './schema.mjs';

const cliSpawn = createRequire(import.meta.url)('../cli-spawn.js');
const BIG_FILE = 8 * 1024 * 1024;
const SAFE_PATH = /^[A-Za-z0-9._\-/@+]+$/;

// Relative, forward-slash path that stays inside its root, else null.
export function relInside(p) {
  if (typeof p !== 'string' || p === '' || p.includes('\0')) return null;
  if (path.isAbsolute(p) || path.win32.isAbsolute(p) || /^[A-Za-z]:/.test(p)) return null;
  const n = path.posix.normalize(p.replace(/\\/g, '/'));
  return n === '.' || n === '..' || n.startsWith('../') ? null : n;
}

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
export const matchesAny = (file, globs) => globs.some((g) => globToRegExp(g).test(file));

function hashFile(abs) {
  try {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) return `link:${fs.readlinkSync(abs)}`;
    if (!st.isFile()) return `other:${st.size}`;
    if (st.size > BIG_FILE) return `big:${st.size}:${st.mtimeMs}`;
    return crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex');
  } catch { return 'deleted'; }
}

// { ok, files: { <path relative to cwd>: content hash } } for every path git reports as changed or untracked.
// ok:false when cwd is no git work tree or git is missing: the scope cannot be checked then.
export function gitSnapshot(cwd, run = cliSpawn.run) {
  const top = run('git', ['-C', cwd, 'rev-parse', '--show-prefix'], { timeout: 15000 });
  if (top.status !== 0) return { ok: false, files: {} };
  const prefix = top.stdout.trim();
  const st = run('git', ['-C', cwd, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { timeout: 60000 });
  if (st.status !== 0) return { ok: false, files: {} };
  const tokens = st.stdout.split('\0').filter(Boolean);
  const files = {};
  const add = (repoPath) => {
    const inside = prefix === '' || repoPath.startsWith(prefix);
    const rel = inside ? repoPath.slice(prefix.length) : `../${repoPath}`;
    files[rel] = hashFile(path.join(cwd, rel));
  };
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i].slice(0, 2);
    add(tokens[i].slice(3));
    if (/[RC]/.test(code)) add(tokens[++i] ?? ''); // a rename lists the old path as the next entry
  }
  return { ok: true, files };
}

export function changedBetween(before, after) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter((n) => before[n] !== after[n]).sort();
}

const RUN_STORE = /^production_artifacts\/(runs\/|state\.json$)/;

// -> { problems: [{ id, summary }], notes: [string] }. Only an "ok" report is checked: the others do not advance the loop.
export function verifyReport({ step, report, cwd, before, after, artifactKey }) {
  const problems = [];
  const notes = [];
  if (report.status !== 'ok') return { problems, notes };

  const required = step.kind === 'plan' ? ['plan'] : step.kind === 'build' && artifactKey ? [artifactKey] : [];
  for (const k of required) if (!report.artifacts[k]) problems.push({ id: 'artifact-missing', summary: `artifacts.${k} is required for this step` });
  if (step.kind === 'ship') {
    const missing = GATE_KEYS.filter((k) => report.gate?.[k] === undefined);
    if (missing.length) problems.push({ id: 'gate-incomplete', summary: `gate lacks ${missing.join(', ')}` });
  }

  let rootReal = cwd;
  try { rootReal = fs.realpathSync(cwd); } catch { /* checked below per artifact */ }
  for (const [k, v] of Object.entries(report.artifacts)) {
    const rel = relInside(v);
    if (!rel) { problems.push({ id: 'artifact-path', summary: `artifacts.${k} must be a relative path inside the work tree, got ${v}` }); continue; }
    // Artifact paths end up in later briefs and in commands such as `aos-plan-canvas open <plan>`: no shell metacharacters.
    if (!SAFE_PATH.test(rel)) { problems.push({ id: 'artifact-path', summary: `artifacts.${k} may use only letters, digits and . _ - / @ + in its path, got ${v}` }); continue; }
    let real;
    try { real = fs.realpathSync(path.join(cwd, rel)); } catch { problems.push({ id: 'artifact-missing', summary: `artifacts.${k} does not exist: ${rel}` }); continue; }
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) problems.push({ id: 'artifact-path', summary: `artifacts.${k} leaves the work tree through a link: ${rel}` });
  }

  if (before?.ok && after?.ok) {
    const expected = relInside(path.relative(cwd, step.expected_report).split(path.sep).join('/'));
    for (const f of changedBetween(before.files, after.files)) {
      if (f === expected || RUN_STORE.test(f)) continue;
      if (f.startsWith('../') || !matchesAny(f, step.allowed_writes)) {
        problems.push({ id: 'scope', summary: `${f} changed outside allowed_writes (${step.allowed_writes.join(', ') || 'none'})` });
      }
    }
  } else if (step.kind !== 'human') {
    notes.push('scope not checked: the work tree is no git repository, or git is missing or failed');
  }
  return { problems, notes };
}
