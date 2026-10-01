#!/usr/bin/env node
// pr-recap: turn a git range or PR into a Plan Builder recap folder (plan.mdx + HTML).
// Reads git locally and, for --pr, `gh pr view` read-only. Never posts anywhere.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const USAGE = `usage: node pr-recap.mjs (--range <base..head> | --pr <n>) [--out <dir>] [--verification <file.json>]
                       [--before <img> --after <img>] [--title <t>] [--open]`;
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const TREE_CAP = 200;
const MAP_CAP = 60;

class UsageError extends Error {}
const fail = (msg) => { throw new UsageError(msg); };

function parseArgs(argv) {
  const opts = { open: false };
  const valued = new Set(['range', 'pr', 'out', 'verification', 'before', 'after', 'title']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) fail(`unexpected argument: ${a}`);
    const key = a.slice(2);
    if (key === 'open') { opts.open = true; continue; }
    if (!valued.has(key)) fail(`unknown option: ${a}`);
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) fail(`${a} needs a value`);
    opts[key] = v;
  }
  if (!opts.range === !opts.pr) fail('give exactly one of --range or --pr');
  if (opts.range && (opts.range.startsWith('-') || !/^[^\s]+\.\.\.?[^\s]+$/.test(opts.range))) fail(`--range must look like base..head, got: ${opts.range}`);
  if (opts.pr && !/^\d+$/.test(opts.pr)) fail(`--pr must be a number, got: ${opts.pr}`);
  if (Boolean(opts.before) !== Boolean(opts.after)) fail('--before and --after must be given together');
  for (const k of ['before', 'after']) {
    if (!opts[k]) continue;
    if (!IMG_EXT.has(extname(opts[k]).toLowerCase())) fail(`--${k} must be one of ${[...IMG_EXT].join(' ')}`);
    if (!existsSync(opts[k])) fail(`--${k} file not found: ${opts[k]}`);
  }
  return opts;
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const git = (...args) => run('git', args);

// Git and GitHub text is untrusted. `line` is for frontmatter and markdown
// prose: single line, no characters MDX or markdown would act on.
const line = (s, max = 160) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/[<>{}`"\\|]/g, '·').trim().slice(0, max);
// `lit` is for JSX props: a JSON string literal with < > { } also \u-escaped.
const lit = (s) => JSON.stringify(String(s ?? '')).replace(/[<>{}]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

function diffFiles(range) {
  const status = git('diff', '--name-status', '-z', '-M', range, '--').split('\0').filter((x) => x !== '');
  const files = new Map();
  for (let i = 0; i < status.length;) {
    const code = status[i++][0];
    const from = code === 'R' || code === 'C' ? status[i++] : null;
    const path = status[i++];
    files.set(path, { path, change: code === 'A' || code === 'C' ? 'added' : code === 'D' ? 'deleted' : 'modified', from, add: 0, del: 0 });
  }
  const num = git('diff', '--numstat', '-z', '-M', range, '--').split('\0');
  for (let i = 0; i < num.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(num[i]);
    if (!m) continue;
    let path = m[3];
    if (path === '') { i += 2; path = num[i]; }
    const f = files.get(path);
    if (f) { f.add = m[1] === '-' ? 0 : Number(m[1]); f.del = m[2] === '-' ? 0 : Number(m[2]); }
  }
  return [...files.values()];
}

function fromGh(n) {
  let pr;
  try {
    pr = JSON.parse(run('gh', ['pr', 'view', n, '--json', 'title,headRefName,baseRefName,headRefOid,baseRefOid,author,files,additions,deletions']));
  } catch (e) {
    throw new Error(`gh pr view ${n} failed (is gh installed and authenticated?): ${String(e.stderr || e.message).trim()}`);
  }
  let files;
  try {
    files = diffFiles(`${pr.baseRefOid}..${pr.headRefOid}`);
  } catch {
    // ponytail: commits not fetched locally, so fall back to gh's file list (no rename info)
    files = (pr.files || []).map((f) => ({ path: f.path, change: f.changeType === 'ADDED' ? 'added' : f.changeType === 'DELETED' ? 'deleted' : 'modified', from: null, add: f.additions || 0, del: f.deletions || 0 }));
  }
  return { files, title: pr.title, branch: pr.headRefName, base: pr.baseRefName, commit: String(pr.headRefOid || '').slice(0, 7), author: pr.author?.login, pr: `#${n}` };
}

function fromRange(range) {
  const files = diffFiles(range);
  const head = range.split(/\.\.\.?/)[1];
  const last = git('log', '-1', '--format=%h%x1f%an%x1f%s', head).trim().split('\x1f');
  return { files, title: last[2], branch: head, base: range.split(/\.\.\.?/)[0], commit: last[0], author: last[1] };
}

function readVerification(file) {
  let rows;
  try { rows = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { fail(`--verification is not readable JSON: ${e.message}`); }
  if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.command !== 'string' || !Number.isInteger(r.exit))) fail('--verification must be an array of {command, exit (integer), note?}');
  return rows;
}

function treeEntries(files) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : 1));
  const out = [];
  const seen = new Set();
  for (const f of sorted) {
    const parts = f.path.split('/');
    for (let d = 0; d < parts.length - 1; d++) {
      const dir = parts.slice(0, d + 1).join('/');
      if (!seen.has(dir)) { seen.add(dir); out.push(`{ path: ${lit(dir)}, depth: ${d}, change: "modified" }`); }
    }
    const note = (f.from ? `renamed from ${f.from}; ` : '') + `+${f.add} -${f.del}`;
    out.push(`{ path: ${lit(f.path)}, depth: ${parts.length - 1}, change: ${lit(f.change)}, note: ${lit(note)} }`);
  }
  return out;
}

function buildPlan({ info, verification, images, title }) {
  const files = info.files;
  const shown = files.slice(0, TREE_CAP);
  const adds = files.reduce((s, f) => s + f.add, 0);
  const dels = files.reduce((s, f) => s + f.del, 0);
  const fm = [['title', title || info.title || 'Change recap'], ['subtitle', 'Recap generated from the diff. The Summary needs a human or agent to fill it in.'], ['kind', 'recap'],
    ['pr', info.pr], ['branch', info.branch], ['base', info.base], ['commit', info.commit], ['files', files.length], ['additions', adds], ['deletions', dels],
    ['author', info.author], ['date', new Date().toISOString().slice(0, 10)]]
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'number' ? v : `"${line(v)}"`}`);

  const rows = verification.map((v) => `[${lit(line(v.command, 200))}, ${lit(String(v.exit))}, ${lit(v.exit === 0 ? 'Verified' : 'Not verified (failed)')}, ${lit(line(v.note || '', 200))}]`);
  const ok = verification.filter((v) => v.exit === 0).map((v) => `- \`${line(v.command, 120)}\` exited 0${v.note ? `: ${line(v.note, 120)}` : ''}`);
  const bad = verification.filter((v) => v.exit !== 0).map((v) => `- \`${line(v.command, 120)}\` exited ${v.exit}${v.note ? `: ${line(v.note, 120)}` : ''}`);
  const verified = ok.length ? ok.join('\n') : '- Nothing was recorded as passing';
  const notVerified = [...bad, '- Everything not listed in the table above was not run'].join('\n');

  const parts = [`---\n${fm.join('\n')}\n---\n`,
    '## Summary\n\n- **What:** TODO fill in: what changed, in one sentence\n- **Why:** TODO fill in: the reason for the change\n- **Scope:** TODO fill in: what is deliberately untouched\n',
    `## Changed areas\n\n<FileTree title="Files" entries={[\n  ${treeEntries(shown).join(',\n  ')},\n]} />\n`,
    `<ImplementationMap title="What each file does now" files={[\n  ${files.slice(0, MAP_CAP).map((f) => `{ path: ${lit(f.path)}, change: ${lit(f.change)}, note: "TODO fill in: what this file does now" }`).join(',\n  ')},\n]} />\n`];
  if (files.length > TREE_CAP || files.length > MAP_CAP) parts.push(`<Callout tone="note" title="Large diff">\n\nThe diff touches ${files.length} files. The tree shows the first ${Math.min(files.length, TREE_CAP)} and the implementation map the first ${Math.min(files.length, MAP_CAP)}. The rest are not listed.\n\n</Callout>\n`);
  if (images) parts.push(`### Most important change\n\n<Compare>\n<Before>\n\n![Before](${images.before})\n\n</Before>\n<After>\n\n![After](${images.after})\n\n</After>\n</Compare>\n`);
  parts.push(`## Verification\n\n<Table title="Commands run" columns={["Command", "Exit code", "Status", "Note"]} rows={[\n  ${rows.length ? rows.join(',\n  ') : '["none recorded", "-", "Not verified", "no --verification file given"]'},\n]} />\n`,
    `<Columns columns={[\n  { label: "Verified", blocks: ${lit(verified)} },\n  { label: "Not verified", blocks: ${lit(notVerified)} },\n]} />\n`,
    '## Risks and follow-ups\n\n<Checklist title="Risks and follow-ups">\n- [ ] Fill in the Summary and the implementation notes before sharing\n- [ ] Review every item under Not verified\n- [ ] Informational recap: it does not gate the merge\n</Checklist>\n');
  return parts.join('\n');
}

function loadBuilder() {
  const req = createRequire(import.meta.url);
  for (const rel of ['../../plan-canvas/scripts/lib/plan-builder', '../../../global_config/plan-canvas/scripts/lib/plan-builder']) {
    const p = resolve(HERE, rel);
    if (existsSync(join(p, 'index.js'))) return req(p);
  }
  return null;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const verification = opts.verification ? readVerification(opts.verification) : [];
  let info;
  try { info = opts.pr ? fromGh(opts.pr) : fromRange(opts.range); } catch (e) { if (e instanceof UsageError) throw e; throw new Error(`git failed: ${String(e.stderr || e.message).trim()}`); }

  const slug = (opts.pr ? `pr-${opts.pr}` : opts.range.replace(/[^A-Za-z0-9._-]+/g, '-')).slice(0, 80);
  const out = resolve(opts.out || join('production_artifacts', 'pr-recap', slug));
  mkdirSync(out, { recursive: true });
  let images = null;
  if (opts.before) {
    images = { before: `before${extname(opts.before).toLowerCase()}`, after: `after${extname(opts.after).toLowerCase()}` };
    copyFileSync(opts.before, join(out, images.before));
    copyFileSync(opts.after, join(out, images.after));
  }
  writeFileSync(join(out, 'plan.mdx'), buildPlan({ info, verification, images, title: opts.title }));
  console.log(`plan folder: ${out}`);

  const builder = loadBuilder();
  if (!builder) {
    console.error('Plan Builder renderer not found (expected plan-canvas next to pr-recap). plan.mdx was written but not rendered; install the plan-canvas skill and rerun.');
    return 3;
  }
  const r = builder.renderPlanFolder(out);
  console.log(`rendered: ${r.outFile} (${r.warnings.length} warnings)`);
  for (const w of r.warnings) console.error(`warning: ${w}`);
  if (opts.open) {
    const o = spawnSync('aos-plan-canvas', ['open', out, '--mode', 'bdb-plan-builder'], { stdio: 'inherit' });
    if (o.status !== 0) { console.error('aos-plan-canvas open failed or is not installed'); return 1; }
  }
  if (opts.pr) console.log(`Not posted. To share it yourself, review the page first, then run:\n  gh pr comment ${opts.pr} --body "Visual recap (informational): <paste summary>"`);
  return 0;
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(e instanceof UsageError ? `error: ${e.message}\n${USAGE}` : `error: ${e.message}`);
  process.exitCode = e instanceof UsageError ? 2 : 1;
}
