// Every child process AOS can start on Windows passes windowsHide: without it a console app started from a process
// that has no console window of its own (a detached service, a hook of a GUI harness) opens a new visible console
// (the window storm during `aos update` and at Codex session start). Static check of every direct child_process
// call in the shipped code; an exception needs an entry in ALLOW with its reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = ['installer.js', 'lib', 'bin', '.claude/hooks', '.claude/workflows', 'agy-hooks', '.opencode/plugins'];
const NAMES = 'spawn|spawnSync|execSync|execFile|execFileSync|exec|fork';
// A call whose program is one of these tools never runs on Windows (they exist on macOS or Linux only).
const POSIX_ONLY = /^(?:launchctl|codesign|ditto|plutil|hdiutil|xattr|systemctl|ps|osascript|security|mkfifo|sfltool)$/;
// "<file>: <start of the call>" -> why that call may go without windowsHide.
const ALLOW = {};

function files() {
  const out = [];
  const walk = (p) => {
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) return;
    if (st.isDirectory()) { for (const f of readdirSync(p)) if (f !== 'node_modules') walk(join(p, f)); }
    else if (/\.(?:c?js|mjs)$/.test(p)) out.push(p);
  };
  for (const s of SCOPE) walk(join(ROOT, s));
  return out;
}

// The argument text of the call that opens at `i` (just after its "("): balanced parens, string contents skipped.
function argsAt(src, i) {
  let depth = 1;
  let q = null;
  const start = i;
  for (; i < src.length && depth; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; } else if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
  }
  return src.slice(start, i - 1);
}

// True when the text before a match on its line opens a // comment (an even number of quotes before the //).
const inLineComment = (prefix) => {
  const at = prefix.search(/(?:^|\s)\/\//);
  return at >= 0 && (prefix.slice(0, at).match(/['"`]/g) || []).length % 2 === 0;
};

export function callSites(src) {
  // Names bound to a child_process function in this file, aliases included (`execFileSync as efs`, `{ spawn: sp }`).
  const locals = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]|\{([^}]*)\}\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g)) {
    for (const part of (m[1] ?? m[2]).split(',')) {
      const [orig, alias] = part.trim().split(/\s+as\s+|\s*:\s*/);
      if (orig && new RegExp(`^(?:${NAMES})$`).test(orig.trim())) locals.add((alias || orig).trim());
    }
  }
  const bare = [...locals].map((n) => n.replace(/\$/g, '\\$')).join('|');
  const sites = [];
  const re = new RegExp(String.raw`(?:(?:\bchild_process|\bcp|\bchildProcess|require\(\s*['"](?:node:)?child_process['"]\s*\))\s*\??\.\s*(?:${NAMES})${bare ? String.raw`|(?<![\w$.])(?:${bare})` : ''})\s*\(`, 'g');
  for (const m of src.matchAll(re)) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const lineEnd = src.indexOf('\n', m.index);
    const line = src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    const prefix = src.slice(lineStart, m.index);
    if (/^\s*(?:\/\/|\*)/.test(line) || inLineComment(prefix) || /\bfunction\s*\*?\s*$/.test(prefix)) continue;
    const args = argsAt(src, m.index + m[0].length);
    // The program: a string literal first argument, or the first word of a shell command string.
    const program = /^\s*['"`]\s*([^\s'"`]+)/.exec(args)?.[1] ?? '';
    // Options passed as a variable (`opts`, `...opts`) count when that variable is an object literal with windowsHide
    // defined in the eight lines before the call.
    const before = src.slice(0, lineStart).split('\n').slice(-8).join('\n');
    const viaVar = [...args.matchAll(/(?:\.\.\.|,\s*)([A-Za-z_$][\w$]*)\s*(?=[,)}]|$)/g)].some(([, id]) => new RegExp(`\\b${id.replace(/\$/g, '\\$')}\\s*=\\s*\\{[^}]*windowsHide`).test(before));
    sites.push({ line: src.slice(0, m.index).split('\n').length, text: line.trim(), args, program, hidden: /windowsHide/.test(args) || viaVar });
  }
  return sites;
}

test('the call-site scanner sees direct, member and require() calls, and skips look-alikes', () => {
  const src = [
    "import { spawn, execFileSync as efs } from 'node:child_process';",
    "spawn('node', ['x'], { stdio: 'ignore' });",
    "efs('git', ['status'], { windowsHide: true });",
    "require('child_process').spawnSync('npm', ['-v'], {});",
    'child_process?.spawn(cmd, [], { windowsHide: true });',
    '/x/.exec(s); db.exec("PRAGMA x"); // spawn(a)',
    "launchctl.exec('x'); function exec(a) {}",
    "const opts = { stdio: 'ignore', windowsHide: true };",
    "efs('git', ['log'], opts);",
    'spawn(`launchctl unload "${p}"`, { stdio: "ignore" });',
  ].join('\n');
  const s = callSites(src);
  assert.deepEqual(s.map((x) => [x.line, x.hidden]), [[2, false], [3, true], [4, false], [5, true], [9, true], [10, false]]);
  assert.deepEqual(s.map((x) => x.program), ['node', 'git', 'npm', '', 'git', 'launchctl']);
});

test('every child process that can run on Windows is started with windowsHide', () => {
  const missing = [];
  let seen = 0;
  for (const f of files()) {
    const src = readFileSync(f, 'utf8');
    if (!/child_process/.test(src)) continue;
    const rel = relative(ROOT, f).split('\\').join('/');
    for (const s of callSites(src)) {
      seen++;
      if (s.hidden || POSIX_ONLY.test(s.program)) continue;
      if (Object.keys(ALLOW).some((k) => k === `${rel}: ${s.text.slice(0, k.length - rel.length - 2)}`)) continue;
      missing.push(`${rel}:${s.line}: ${s.text.slice(0, 160)}`);
    }
  }
  assert.ok(seen > 100, `the scanner found only ${seen} call sites; it is probably broken`);
  assert.deepEqual(missing, [], `child processes without windowsHide (add it, or an ALLOW entry with the reason):\n${missing.join('\n')}`);
});
