#!/usr/bin/env node
// Validates every skill in skills/ against the contract in AGENTS.md.
// Zero dependencies on purpose: CI runs this with no install step, and it must
// work on any harness, not just the one that happens to ship a hook runner.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(REPO, 'skills');

const CATEGORIES = new Set([
  'design-ui-ux', 'engineering-method', 'media-eventtech',
  'bdb-core', 'saas-ops', 'library',
]);
const REQUIRED = ['name', 'description', 'category'];

// Names that are stand-ins or service accounts rather than a person. The rule
// is about leaking a human's username; `/home/agent` on the SaaS fleet is a
// role account and is meant to be written down.
const PLACEHOLDER_USERS = new Set([
  'username', '<username>', '{username}', '$USER', 'USER', 'user', 'you', 'your-username',
  'john', 'jane', 'example', 'me', 'name', '<user>', 'ubuntu', 'runner', 'YOUR_NAME',
  'agent', 'root', 'admin', 'deploy', 'app', 'node', 'git', 'www-data', 'service',
]);

// ---------------------------------------------------------------- YAML scanner
// Not a general YAML parser — it resolves scalar boundaries, which is the only
// thing needed to tell a real key from text absorbed into the value above it.
// That distinction is the whole point: a `grep "^category:"` says these files
// are fine, because the line is physically present and semantically swallowed.

function findClosingQuote(s, from, q) {
  for (let i = from; i < s.length; i++) {
    if (s[i] !== q) continue;
    if (q === "'" && s[i + 1] === "'") { i++; continue; }   // '' escapes a quote
    if (q === '"' && s[i - 1] === '\\') continue;
    return i;
  }
  return -1;
}

const indentOf = (l) => l.length - l.trimStart().length;
const KEY_RE = /^([A-Za-z_][\w.-]*)\s*:(.*)$/;

export function scanFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { ok: false, reason: 'missing', keys: [], issues: [] };

  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { close = i; break; }
  }
  if (close === -1) return { ok: false, reason: 'unterminated', keys: [], issues: [] };

  const body = lines.slice(1, close);
  const keys = [];
  const issues = [];
  let i = 0;

  while (i < body.length) {
    const line = body[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) { i++; continue; }
    if (indentOf(line) > 0) { i++; continue; }

    const m = KEY_RE.exec(line);
    if (!m) { i++; continue; }

    const key = m[1];
    const rest = m[2];
    const restT = rest.trim();
    const start = i;
    const consumed = [rest];
    let swallowed = [];

    const eatIndented = (allowBlank) => {
      i++;
      while (i < body.length) {
        const l = body[i];
        if (l.trim() === '') { if (!allowBlank) break; consumed.push(l); i++; continue; }
        if (indentOf(l) === 0) break;
        consumed.push(l); i++;
      }
    };

    if (/^[|>][-+]?\d*$/.test(restT)) {
      eatIndented(true);                                   // block scalar
    } else if (restT === '') {
      eatIndented(true);                                   // nested mapping / empty
    } else if (restT[0] === "'" || restT[0] === '"') {
      const q = restT[0];
      const offset = rest.indexOf(q);
      if (findClosingQuote(rest, offset + 1, q) !== -1) {
        i++;                                               // closes on its own line
      } else {
        i++;
        let closed = false;
        while (i < body.length) {
          const l = body[i];
          consumed.push(l);
          i++;
          if (indentOf(l) === 0 && KEY_RE.test(l)) swallowed.push(KEY_RE.exec(l)[1]);
          if (findClosingQuote(l, 0, q) !== -1) { closed = true; break; }
        }
        if (!closed) issues.push({ code: 'E-YAML02', key, msg: `quoted value for \`${key}\` is never closed` });
      }
    } else {
      eatIndented(false);                                  // plain scalar
    }

    if (swallowed.length) {
      issues.push({
        code: 'E-YAML03', key,
        msg: `the quoted value of \`${key}\` swallows ${swallowed.map((k) => `\`${k}\``).join(', ')} — ` +
             `${swallowed.length > 1 ? 'those keys are' : 'that key is'} not parsed at all`,
      });
    }

    keys.push({
      key,
      line: start + 2,                                     // +1 for the opening ---, +1 for 1-indexing
      multiline: consumed.length > 1,
      value: consumed.join(' ').trim().replace(/\s+/g, ' '),
    });
  }

  return { ok: true, keys, issues, endLine: close + 1 };
}

function unquote(v) {
  const t = v.trim();
  if (t.length > 1 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0]) return t.slice(1, -1).trim();
  return t;
}

// ------------------------------------------------------------------ collectors

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function collect() {
  const files = walk(SKILLS);
  const skills = files.filter((f) => basename(f) === 'SKILL.md');
  // A .md sitting directly in a category dir is a skill nobody can load: every
  // harness discovers skills as <dir>/SKILL.md.
  const strays = files.filter((f) => {
    if (basename(f) === 'SKILL.md' || !f.endsWith('.md')) return false;
    const rel = relative(SKILLS, f);
    return rel.split('/').length === 2;
  });
  return { skills, strays };
}

// ---------------------------------------------------------------------- checks

// A skill that documents the no-usernames rule has to be able to show a
// counter-example. `<!-- validate-skills-ignore -->` on the line, or the line
// above, says this one is deliberate.
const IGNORE = 'validate-skills-ignore';

function checkLeakedPaths(text, file, findings) {
  const patterns = [/\/Users\/([^/\s`'")\],]+)/g, /\/home\/([^/\s`'")\],]+)/g, /C:\\Users\\([^\\\s`'")\],]+)/g];
  const lines = text.split(/\r?\n/);
  for (const re of patterns) {
    for (let n = 0; n < lines.length; n++) {
      if (lines[n].includes(IGNORE) || (n > 0 && lines[n - 1].includes(IGNORE))) continue;
      for (const m of lines[n].matchAll(re)) {
        const who = m[1].replace(/[<>{}]/g, '');
        if (PLACEHOLDER_USERS.has(m[1]) || PLACEHOLDER_USERS.has(who)) continue;
        findings.push({
          level: 'error', code: 'E-PATH01', file, line: n + 1,
          msg: `absolute home path leaks a username: \`${m[0]}\` — use \`~\` or \`$HOME\``,
        });
      }
    }
  }
}

function checkLocalRefs(text, skillDir, file, findings) {
  const re = /`([a-zA-Z0-9_@-]+\/[a-zA-Z0-9_./@-]+\.(?:md|py|mjs|js|ts|sh|json))`/g;
  const seen = new Set();
  for (const m of text.matchAll(re)) {
    const p = m[1];
    if (seen.has(p) || p.startsWith('~') || p.startsWith('.') || p.includes('://')) continue;
    if (!/^(references|scripts|assets|rules|contracts|resources|templates)\//.test(p)) continue;
    seen.add(p);
    if (!existsSync(join(skillDir, p))) {
      findings.push({ level: 'warn', code: 'W-REF01', file, msg: `references \`${p}\`, which does not exist in this skill` });
    }
  }
}

// Only hyphenated `/slash-names` are checked. Single words in that position are
// nearly always something else — a route, a temp path, a pipeline stage in
// prose, a harness builtin — and flagging them buries the real hits.
const HARNESS_BUILTINS = new Set([
  'code-review', 'plan-mode', 'add-dir', 'bug-report', 'output-style', 'export-conversation',
]);

function checkSkillRefs(text, file, known, self, findings) {
  const seen = new Set();
  for (const m of text.matchAll(/`\/([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g)) {
    const name = m[1];
    if (seen.has(name) || name === self || known.has(name) || HARNESS_BUILTINS.has(name)) continue;
    seen.add(name);
    findings.push({ level: 'warn', code: 'W-REF02', file, msg: `references skill \`/${name}\`, which does not exist` });
  }
}

function validate() {
  const { skills, strays } = collect();
  const known = new Set(skills.map((f) => basename(dirname(f))));
  const findings = [];

  for (const file of skills) {
    const rel = relative(REPO, file);
    const dir = dirname(file);
    const dirName = basename(dir);
    const text = readFileSync(file, 'utf8');
    const fm = scanFrontmatter(text);

    if (!fm.ok) {
      findings.push({
        level: 'error', code: 'E-FM01', file: rel,
        msg: fm.reason === 'missing' ? 'no YAML frontmatter block' : 'frontmatter block is never closed',
      });
      continue;
    }

    for (const iss of fm.issues) findings.push({ level: 'error', code: iss.code, file: rel, msg: iss.msg });

    const byKey = new Map(fm.keys.map((k) => [k.key, k]));

    for (const req of REQUIRED) {
      if (!byKey.has(req)) {
        findings.push({ level: 'error', code: 'E-FM02', file: rel, msg: `missing required key \`${req}\`` });
      }
    }

    const name = byKey.get('name');
    if (name && unquote(name.value) !== dirName) {
      findings.push({
        level: 'error', code: 'E-FM04', file: rel, line: name.line,
        msg: `\`name: ${unquote(name.value)}\` does not match its directory \`${dirName}\``,
      });
    }

    const desc = byKey.get('description');
    if (desc && unquote(desc.value) === '') {
      findings.push({ level: 'error', code: 'E-FM05', file: rel, line: desc.line, msg: 'description is empty' });
    }

    const cat = byKey.get('category');
    if (cat) {
      const value = unquote(cat.value);
      if (cat.multiline) {
        findings.push({
          level: 'error', code: 'E-YAML01', file: rel, line: cat.line,
          msg: `\`category\` absorbs the line below it and parses as "${value.slice(0, 60)}${value.length > 60 ? '…' : ''}" ` +
               '— quote the description above it so the value ends where you think it does',
        });
      } else if (!CATEGORIES.has(value)) {
        findings.push({
          level: 'error', code: 'E-FM03', file: rel, line: cat.line,
          msg: `\`category: ${value}\` is not one of: ${[...CATEGORIES].join(', ')}`,
        });
      }
    }

    checkLeakedPaths(text, rel, findings);
    checkLocalRefs(text, dir, rel, findings);
    checkSkillRefs(text, rel, known, dirName, findings);

    // A skill ships more than its SKILL.md, and a leaked path in a reference
    // file is just as published as one in the entry point.
    for (const aux of walk(dir)) {
      if (aux === file || !/\.(md|py|mjs|cjs|js|ts|sh|json|ya?ml)$/.test(aux)) continue;
      checkLeakedPaths(readFileSync(aux, 'utf8'), relative(REPO, aux), findings);
    }
  }

  for (const file of strays) {
    const rel = relative(REPO, file);
    const fm = scanFrontmatter(readFileSync(file, 'utf8'));
    if (!fm.ok || !fm.keys.some((k) => k.key === 'name')) continue;
    findings.push({
      level: 'error', code: 'E-STRAY01', file: rel,
      msg: 'skill frontmatter in a bare .md file — no harness will discover this. ' +
           `Move it to \`${relative(REPO, join(dirname(file), basename(file, '.md'), 'SKILL.md'))}\``,
    });
  }

  return { findings, counts: { skills: skills.length, strays: strays.length } };
}

// ---------------------------------------------------------------------- report

function report(findings, counts, { json, quiet, strict }) {
  const errors = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');

  if (json) {
    console.log(JSON.stringify({ ok: errors.length === 0 && (!strict || warns.length === 0), counts, findings }, null, 2));
    return errors.length || (strict && warns.length) ? 1 : 0;
  }

  const tty = process.stdout.isTTY && !process.env.NO_COLOR;
  const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => c(31, s), yellow = (s) => c(33, s), green = (s) => c(32, s), dim = (s) => c(2, s);

  const show = strict ? findings : (quiet ? errors : findings);
  const byFile = new Map();
  for (const f of show) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  for (const [file, list] of byFile) {
    console.log(`\n${file}`);
    for (const f of list) {
      const tag = f.level === 'error' ? red('error') : yellow(' warn');
      const at = f.line ? dim(`:${f.line}`) : '';
      console.log(`  ${tag} ${dim(f.code)}${at}  ${f.msg}`);
    }
  }

  const summary = `${counts.skills} skills checked · ${errors.length} error(s) · ${warns.length} warning(s)`;
  console.log('');
  if (errors.length === 0 && warns.length === 0) console.log(green(`✓ ${summary}`));
  else if (errors.length === 0) console.log(yellow(`! ${summary}`));
  else console.log(red(`✗ ${summary}`));

  return errors.length || (strict && warns.length) ? 1 : 0;
}

// -------------------------------------------------------------------- selftest

function selftest() {
  // The bug that shipped: an indented line folds into the value above it, so
  // `category` parses as "library used by 60% ..." while grep still sees the key.
  const folded = scanFrontmatter([
    '---', 'name: crewai', 'description: Expert in CrewAI - the leading framework',
    'category: library', '  used by 60% of Fortune 500 companies.', '---',
  ].join('\n'));
  const cat = folded.keys.find((k) => k.key === 'category');
  assert.ok(cat.multiline, 'folded category must be detected as multiline');
  assert.equal(cat.value, 'library used by 60% of Fortune 500 companies.');

  // The other shape: an unclosed quote eats the keys below it entirely.
  const eaten = scanFrontmatter([
    '---', "description: 'Debugging specialist for errors", 'category: library',
    '', '  behavior. Use proactively.', '', "  '", 'risk: safe', '---',
  ].join('\n'));
  assert.ok(!eaten.keys.some((k) => k.key === 'category'), 'swallowed key must not count as present');
  assert.ok(eaten.issues.some((i) => i.code === 'E-YAML03'), 'swallowing must be reported');
  assert.ok(eaten.keys.some((k) => k.key === 'risk'), 'parsing must resume after the closing quote');

  // Legitimate YAML must not trip any of it.
  const clean = scanFrontmatter([
    '---', 'name: ask-tim', 'description: >-', '  A folded block scalar',
    '  spanning several lines.', 'category: bdb-core',
    'metadata:', '  author: firecrawl', '  version: "0.1.0"', '---',
  ].join('\n'));
  const cleanCat = clean.keys.find((k) => k.key === 'category');
  assert.equal(cleanCat.value, 'bdb-core');
  assert.ok(!cleanCat.multiline, 'a clean category is single-line');
  assert.ok(clean.keys.find((k) => k.key === 'description').multiline, 'block scalar spans lines');
  assert.ok(clean.keys.some((k) => k.key === 'metadata'), 'nested mapping is a key');
  assert.ok(!clean.keys.some((k) => k.key === 'author'), 'nested keys are not top-level');
  assert.equal(clean.issues.length, 0);

  // A quoted value that closes on its own line is fine.
  const quoted = scanFrontmatter(['---', 'name: x', 'description: "it\'s fine: really"', 'category: library', '---'].join('\n'));
  assert.equal(quoted.issues.length, 0);
  assert.equal(quoted.keys.find((k) => k.key === 'category').value, 'library');

  assert.equal(scanFrontmatter('# no frontmatter').ok, false);
  assert.equal(scanFrontmatter('---\nname: x\n').reason, 'unterminated');

  console.log('✓ selftest passed');
}

// ------------------------------------------------------------------------ main

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) { selftest(); process.exit(0); }

const { findings, counts } = validate();
process.exit(report(findings, counts, {
  json: argv.includes('--json'),
  quiet: argv.includes('--quiet'),
  strict: argv.includes('--strict'),
}));
