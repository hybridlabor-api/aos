#!/usr/bin/env node
// Deterministic source search for a canvas annotation: literal matches over git-tracked
// files only. Page data is never used as a regex, a path or a shell argument.

import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SRC_EXTS as EXTS, SRC_SKIP_DIRS as SKIP_DIRS, cleanClasses, cleanSnippet, fromAnnotation, resolveSrcLoc, sanitizeElement } from './sanitize-element.mjs';

const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 5000;
const MAX_LINE = 2000;
const MIN_SNIPPET = 3;
const MIN_SCORE = 3;
const TOP = 3;

function trackedFiles(realRoot) {
  const out = execFileSync('git', ['-C', realRoot, 'ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return out.toString('utf8').split('\0').filter(Boolean);
}

const CLASS_CHAR = /[\w-]/;
const TAG_CHAR = /[\w:.-]/;

// Literal match that does not continue into a longer name (`<b` vs `<button`, `btn` vs `submitBtn`).
function hasWord(line, needle, wordChar) {
  const startIsWord = wordChar.test(needle[0]);
  for (let at = line.indexOf(needle); at !== -1; at = line.indexOf(needle, at + 1)) {
    const before = line[at - 1];
    const after = line[at + needle.length];
    if ((!startIsWord || before === undefined || !wordChar.test(before)) && (after === undefined || !wordChar.test(after))) return true;
  }
  return false;
}

function scanFile(realRoot, rel, q, hits) {
  const abs = path.join(realRoot, rel);
  let text;
  try {
    const st = lstatSync(abs);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return;
    if (!realpathSync(abs).startsWith(realRoot + path.sep)) return;
    const buf = readFileSync(abs);
    if (buf.includes(0)) return;
    text = buf.toString('utf8');
  } catch {
    return;
  }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].slice(0, MAX_LINE);
    const snippet = q.snippet.length >= MIN_SNIPPET && line.includes(q.snippet);
    const classes = q.classes.filter((c) => hasWord(line, c, CLASS_CHAR)).length;
    const tag = q.tag && hasWord(line, `<${q.tag}`, TAG_CHAR);
    const score = (snippet ? 3 : 0) + classes + (tag ? 1 : 0);
    if (score >= MIN_SCORE) {
      const why = [snippet && 'snippet', classes && `${classes} class`, tag && 'tag'].filter(Boolean).join('+');
      hits.push({ file: rel, line: i + 1, score, why, snippet, classes });
    }
  }
}

/**
 * input: { anchor: {tag, classes, snippet}, srcLoc? }. Returns
 * { confidence: 'exact'|'likely'|'ambiguous'|'none', candidates: [{file, line, score, why}], scanned, truncated }.
 */
export function locateSource(input, { root, maxFiles = MAX_FILES } = {}) {
  const none = { confidence: 'none', candidates: [], scanned: 0, truncated: false };
  let realRoot;
  try {
    realRoot = realpathSync(root);
  } catch {
    return none;
  }
  const exactFile = input && input.srcLoc ? resolveSrcLoc(input.srcLoc, realRoot) : null;
  if (exactFile) {
    const line = Number(input.srcLoc.match(/:(\d+)/)[1]);
    return { ...none, confidence: 'exact', candidates: [{ file: path.relative(realRoot, exactFile), line, score: 0, why: 'data-aos-src' }] };
  }
  const anchor = (input && input.anchor) || {};
  const tag = typeof anchor.tag === 'string' ? sanitizeElement({ tag: anchor.tag })?.tag : null;
  const q = { tag, classes: cleanClasses(anchor.classes), snippet: cleanSnippet(anchor.snippet) };
  let files;
  try {
    files = trackedFiles(realRoot);
  } catch {
    return none;
  }
  const hits = [];
  let scanned = 0;
  let truncated = false;
  for (const rel of files) {
    const segs = rel.split('/');
    if (!EXTS.has(path.extname(rel)) || segs.slice(0, -1).some((s) => SKIP_DIRS.has(s))) continue;
    if (scanned >= maxFiles) { truncated = true; break; }
    scanned++;
    scanFile(realRoot, rel, q, hits);
  }
  hits.sort((a, b) => b.score - a.score || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  const top = hits.slice(0, TOP);
  if (!top.length) return { ...none, scanned, truncated };
  const [first, second] = top;
  const likely = first.snippet && first.classes >= 1 && (!second || first.score - second.score >= 2);
  return {
    confidence: likely ? 'likely' : 'ambiguous',
    candidates: top.map(({ file, line, score, why }) => ({ file, line, score, why })),
    scanned,
    truncated,
  };
}

const MAX_STDIN = 256 * 1024;

async function main() {
  const rootIdx = process.argv.indexOf('--root');
  const root = rootIdx > 0 ? process.argv[rootIdx + 1] : process.cwd();
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_STDIN) { console.error('input too large'); process.exit(2); }
    chunks.push(chunk);
  }
  let item;
  try { item = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { console.error('invalid JSON'); process.exit(2); }
  const clean = fromAnnotation(item);
  if (!clean) { console.error('no valid element'); process.exit(1); }
  const anchor = item.anchor && typeof item.anchor === 'object' ? item.anchor : {};
  console.log(JSON.stringify(locateSource({ anchor: { tag: clean.tag, classes: clean.classes, snippet: anchor.snippet }, srcLoc: clean.srcLoc }, { root }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
