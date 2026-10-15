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
  'bdb-core', 'saas-ops', 'library', 'engineering-hardware', 'business-ops',
]);
const REQUIRED = ['name', 'description', 'category'];

// The Agent Skills specification constrains `name` to lowercase letters,
// numbers, and single hyphens, max 64 chars. A harness that enforces the spec
// drops such a skill silently, so a self-consistent name==directory pair is
// not enough: `MCP_Manage` matched its own directory perfectly and was still
// unloadable by pi. Tolerant harnesses hide this; strict ones lose the skill.
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME_MAX = 64;

// Charset and length are one rule. Keeping them as two expressions meant the
// selftest could assert the charset and pass while the length limit lived only
// in validate() -- the two can drift, and then the test proves nothing.
const isValidSkillName = (v) => v.length <= NAME_MAX && NAME_RE.test(v);

export const DESC_MAX = 250;
export function cleanDescription(descKey) {
  if (!descKey) return '';
  let v = unquote(descKey.value);
  v = v.replace(/^[|>][-+]?\d*\s*/, '').trim();
  return v;
}

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
    if (q === '"') { let b = 0, j = i - 1; while (j >= from && s[j] === '\\') { b++; j--; } if (b % 2 !== 0) continue; }
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
      // A plain (unquoted) scalar containing ": " is a nested mapping as far as
      // YAML is concerned. The scanner above takes the rest of the line as the
      // value and sees nothing wrong, and so does every lenient harness — but
      // a spec-conformant reader parses it as a map, drops the frontmatter, and
      // the skill never loads. `description: live map: of a build` is the shape.
      if (/:(\s|$)/.test(restT)) {
        issues.push({
          code: 'E-YAML04', key,
          msg: `plain value of \`${key}\` contains ":" — YAML reads the rest as a nested mapping, not text. ` +
               'Quote the value or fold it (>-); as written the frontmatter does not parse.',
        });
      }
      // go-yaml (agy) rejects a plain item ending in "?" inside a flow list: `inputs: [repo, pr_numbers?]`.
      if (/^\[.*[^\s",[]\?\s*[\],]/.test(restT)) {
        issues.push({ code: 'E-YAML05', key, msg: `flow list \`${key}\` has an unquoted item ending in "?" — agy's YAML reader rejects it. Quote the item ("x?").` });
      }
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

// Playbooks are skills with `kind: playbook`; skills without `kind` are untouched.
const PB_REQUIRED = ['trigger', 'inputs', 'requires', 'go_points', 'outputs', 'verify', 'difficulty', 'est_time'];
const DIFFICULTY = new Set(['beginner', 'intermediate', 'advanced']);
const EXTERNAL = ' (external)';

export function checkPlaybook(byKey, known) {
  const out = [];
  if (!byKey.has('kind')) return out;
  const add = (code, msg, key) => out.push({ level: 'error', code, line: byKey.get(key)?.line, msg });
  const kind = unquote(byKey.get('kind').value);
  if (kind !== 'playbook') {
    add('E-PB01', `\`kind: ${kind}\` is unknown — the only defined kind is \`playbook\``, 'kind');
    return out;
  }
  for (const k of PB_REQUIRED) if (!byKey.has(k)) add('E-PB03', `playbook is missing required key \`${k}\``, 'kind');

  const req = byKey.get('requires');
  if (req) {
    const m = /(?:^|\s)skills:\s*\[([^\]]*)\]/.exec(req.value);
    if (!m) add('E-PB05', '`requires.skills` must be a flow-style list, e.g. `skills: [github, ci-pipeline]`', 'requires');
    else {
      for (const raw of m[1].split(',').map((e) => unquote(e)).filter(Boolean)) {
        if (!raw.endsWith(EXTERNAL) && !known.has(raw)) {
          add('E-PB02', `requires skill \`${raw}\`, which is not a skill in this repo — fix the name or mark it \`${raw}${EXTERNAL}\``, 'requires');
        }
      }
    }
  }
  const diff = byKey.get('difficulty');
  if (diff && !DIFFICULTY.has(unquote(diff.value))) {
    add('E-PB04', `\`difficulty: ${unquote(diff.value)}\` is not one of: ${[...DIFFICULTY].join(', ')}`, 'difficulty');
  }
  const dmi = byKey.get('disable-model-invocation');
  if (dmi && unquote(dmi.value) === 'true') {
    add('E-PB06', 'playbooks must stay invocable by agents — remove `disable-model-invocation: true` (side effects are guarded by go-gate)', 'disable-model-invocation');
  }
  return out;
}

// Pipeline and role skills must stay invocable through the Skill tool: the Master and
// every orchestrator start them. Side effects are guarded by go-gate, not by hiding the
// skill from the model. Anything not listed here may still set the flag.
export const MODEL_INVOCABLE = new Set([
  'startcycle', 'startcycle-graph', 'startcycle-graph-user', 'teamwork-preview',
  'godmode-engineering', 'godmode-shipping', 'godmode-ui-ux', 'godmode-media-eventtech',
  'master-session', 'ao-orchestrator', 'bdbrainstorm', 'bdbmediastorm',
  'grill-me', 'grill-with-docs', 'ask-tim', 'memb-skill',
]);

export function checkInvocation(name, byKey) {
  const dmi = byKey.get('disable-model-invocation');
  if (!dmi || unquote(dmi.value) !== 'true' || !MODEL_INVOCABLE.has(name)) return [];
  return [{ level: 'error', code: 'E-DMI01', line: dmi.line, msg: `\`${name}\` is a pipeline/role skill and must stay model-invocable — remove \`disable-model-invocation: true\` (go-gate guards its side effects)` }];
}

// Tim's policy: model names change weekly, so a skill must never hard-code a
// current model ID as a concrete value. Capability tiers, placeholders
// (`<model-id>`) or environment variables keep the teaching value without
// pinning the text to a model that ships next week.
// Conservative by design: `llama.cpp` (no digit), `claude-code`, `gemma.md`
// tool names without a digit, the words sonnet/opus/haiku alone in prose and
// `o1-lookups`-style anchors do not. Case-insensitive, word-bounded, linear.
const MODEL_NAME_RE = /\bgpt[-_ ]?\d(?!all\b)|\bclaude[-_ ]?\d|\bclaude-(?:opus|sonnet|haiku)|\bgemini-\d|\bllama[-_ ]?\d|\bo[134]-(?:mini|preview)|\btext-embedding-\d|\bmixtral\b|\bqwen\d|\bgemma[-_ ]?\d|(?<![-\w])--model\s+(?:opus|sonnet|haiku)\b/i;

// A skill that documents a forbidden pattern may show a counter-example:
// a fenced block whose opening fence line says "anti-example" is one.
const ANTI_EXAMPLE = /anti[-_ ]?example/i;

export function checkModelNames(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let fence = null;
  for (let n = 0; n < lines.length; n++) {
    const trimmed = lines[n].trim();
    if (/^(```|~~~)/.test(trimmed)) {
      fence = fence === null ? (ANTI_EXAMPLE.test(trimmed) ? 'anti' : 'plain') : null;
      continue;
    }
    if (fence === 'anti') continue;
    if (MODEL_NAME_RE.test(lines[n])) {
      out.push({
        level: 'warn', code: 'W-MODEL01', line: n + 1,
        msg: 'fixed model name in a skill — use a capability tier, a placeholder (`<model-id>`) or an environment variable instead',
      });
    }
  }
  return out;
}

// W-BRAND01: shipped skills and agents must not hard-wire BDB brand tokens.
// Product chrome (plan-canvas UI) and unrelated uses of the word (the Obsidian
// notes app) are allowlisted by path.
const BRAND_RE = /#9b30c4|\bObsidian\b|\bOrchid\b|BDB Master Branding/i;
const BRAND_ALLOW = [/^skills\/global_config\/plan-canvas\//, /^skills\/global_config\/obsidian-markdown\//, /^skills\/global_config\/prompt-engineer\//];

export function checkBrandTokens(text, rel) {
  if (BRAND_ALLOW.some((re) => re.test(rel.split('\\').join('/')))) return [];
  const out = [];
  text.split(/\r?\n/).forEach((l, n) => {
    if (BRAND_RE.test(l)) {
      out.push({ level: 'warn', code: 'W-BRAND01', line: n + 1, file: rel,
        msg: 'BDB brand token in a shipped skill/agent — assert or route by the project\'s own declared tokens instead' });
    }
  });
  return out;
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
    if (name) {
      const value = unquote(name.value);
      if (!isValidSkillName(value)) {
        findings.push({
          level: 'error', code: 'E-NAME01', file: rel, line: name.line,
          msg: `\`name: ${value}\` is not spec-valid — lowercase a-z, 0-9 and single hyphens only, max ${NAME_MAX} chars. ` +
               'A harness that enforces the Agent Skills spec will not load this skill at all.',
        });
      }
      if (value !== dirName) {
        findings.push({
          level: 'error', code: 'E-FM04', file: rel, line: name.line,
          msg: `\`name: ${value}\` does not match its directory \`${dirName}\``,
        });
      }
    }

    const desc = byKey.get('description');
    if (desc) {
      const cleanDesc = cleanDescription(desc);
      if (cleanDesc === '') {
        findings.push({ level: 'error', code: 'E-FM05', file: rel, line: desc.line, msg: 'description is empty' });
      } else if (cleanDesc.length > DESC_MAX) {
        findings.push({
          level: 'warn', code: 'W-DESC01', file: rel, line: desc.line,
          msg: `description is ${cleanDesc.length} characters (budget: max ${DESC_MAX} chars). Frontmatter budget requires concise descriptions to limit session startup token bloat. Shorten while preserving trigger words.`,
        });
      }
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

    for (const f of checkPlaybook(byKey, known)) findings.push({ ...f, file: rel });
    for (const f of checkInvocation(basename(dir), byKey)) findings.push({ ...f, file: rel });

    checkLeakedPaths(text, rel, findings);
    checkLocalRefs(text, dir, rel, findings);
    checkSkillRefs(text, rel, known, dirName, findings);
    for (const f of checkModelNames(text)) findings.push({ ...f, file: rel });
    findings.push(...checkBrandTokens(text, rel));

    // A skill ships more than its SKILL.md, and a leaked path in a reference
    // file is just as published as one in the entry point.
    for (const aux of walk(dir)) {
      if (aux === file || !/\.(md|py|mjs|cjs|js|ts|sh|json|ya?ml)$/.test(aux)) continue;
      const auxText = readFileSync(aux, 'utf8');
      checkLeakedPaths(auxText, relative(REPO, aux), findings);
      findings.push(...checkBrandTokens(auxText, relative(REPO, aux)));
      // The model-name lint covers docs-like aux files (references/, templates/)
      // but never runtime scripts: .py/.js/.mjs code legitimately keeps concrete
      // model IDs so existing installs keep working.
      if (/\.(md|ya?ml)$/.test(aux)) {
        for (const f of checkModelNames(auxText)) findings.push({ ...f, file: relative(REPO, aux) });
      }
    }
  }

  const agentsDir = join(REPO, 'agents');
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir).filter((n) => n.endsWith('.md'))) {
      findings.push(...checkBrandTokens(readFileSync(join(agentsDir, f), 'utf8'), `agents/${f}`));
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

  // A plain scalar holding ": " is a nested mapping to a real YAML reader, so
  // the frontmatter does not parse and the skill never loads. Every lenient
  // harness accepts it, which is how agenttrail shipped: the shape passed this
  // validator, Claude Code and Antigravity, and only pi rejected it.
  const colon = scanFrontmatter([
    '---', 'name: agenttrail', 'description: Live map of a build: which component',
    'category: bdb-core', '---',
  ].join('\n'));
  assert.ok(
    colon.issues.some((i) => i.code === 'E-YAML04'),
    'a plain scalar containing ": " must be reported',
  );
  assert.equal(colon.keys.find((k) => k.key === 'description').value, 'Live map of a build: which component');

  // A colon that is not followed by whitespace is not a mapping boundary --
  // URLs and times are the common false positive.
  const url = scanFrontmatter([
    '---', 'name: firecrawl', 'description: See https://example.com/a:b for the API',
    'category: library', '---',
  ].join('\n'));
  assert.ok(!url.issues.some((i) => i.code === 'E-YAML04'), 'a colon inside a URL is not a mapping');

  // The quoted form of the same text is fine -- that is the fix.
  const quotedColon = scanFrontmatter([
    '---', 'name: agenttrail', 'description: "Live map of a build: which component"',
    'category: bdb-core', '---',
  ].join('\n'));
  assert.equal(quotedColon.issues.length, 0, 'quoting the value resolves E-YAML04');

  const flowQ = (v) => scanFrontmatter(['---', 'name: pb-x', 'description: d', `inputs: ${v}`, '---'].join('\n')).issues.some((i) => i.code === 'E-YAML05');
  assert.ok(flowQ('[repo, pr_numbers?]'), 'an unquoted "x?" flow item must be reported');
  assert.ok(!flowQ('[repo, "pr_numbers?"]'), 'the quoted item is fine');

  assert.equal(scanFrontmatter('# no frontmatter').ok, false);
  assert.equal(scanFrontmatter('---\nname: x\n').reason, 'unterminated');

  // The spec's name charset, and the case that shipped: MCP_Manage matched its
  // own directory perfectly and was still unloadable by a strict reader.
  for (const bad of ['MCP_Manage', 'MCP-manage', 'mcp_manage', '-mcp', 'mcp-', 'mcp--manage', 'mcp manage']) {
    assert.ok(!isValidSkillName(bad), `\`${bad}\` must not be a valid skill name`);
  }
  for (const good of ['mcp-manage', 'ask-tim', 'a', 'skill2', 'a-b-c-1']) {
    assert.ok(isValidSkillName(good), `\`${good}\` must be a valid skill name`);
  }
  assert.ok(isValidSkillName('a'.repeat(NAME_MAX)), 'a 64-char name is at the limit and valid');
  assert.ok(!isValidSkillName('a'.repeat(NAME_MAX + 1)), 'a 65-char name is over the limit');

  // Playbook frontmatter (kind: playbook).
  const pb = (over = {}, drop = []) => {
    const base = {
      name: 'pb-x', description: 'd', category: 'bdb-core', kind: 'playbook',
      trigger: '["a"]', inputs: '[repo]',
      requires: '\n  skills: [github, gh (external)]\n  agents: []\n  mcps: []\n  store: []',
      go_points: '[]', outputs: '["x"]', verify: '"x"', difficulty: 'beginner',
      est_time: '5 min', ...over,
    };
    const lines = Object.entries(base).filter(([k]) => !drop.includes(k)).map(([k, v]) => `${k}: ${v}`);
    const fm = scanFrontmatter(['---', ...lines, '---'].join('\n'));
    return new Map(fm.keys.map((k) => [k.key, k]));
  };
  const known = new Set(['github', 'ci-pipeline']);
  assert.deepEqual(checkPlaybook(pb(), known), [], 'valid playbook is clean');
  const miss = checkPlaybook(pb({}, ['go_points']), known);
  assert.equal(miss.length, 1);
  assert.equal(miss[0].code, 'E-PB03');
  assert.match(miss[0].msg, /go_points/);
  assert.equal(checkPlaybook(pb({ difficulty: 'expert' }), known)[0].code, 'E-PB04');
  const unk = checkPlaybook(pb({ requires: '\n  skills: [github, nope-skill, gh (external)]' }), known);
  assert.equal(unk.length, 1);
  assert.equal(unk[0].code, 'E-PB02');
  assert.match(unk[0].msg, /nope-skill/);
  const kind = checkPlaybook(pb({ kind: 'recipe' }), known);
  assert.equal(kind.length, 1);
  assert.equal(kind[0].code, 'E-PB01');
  assert.equal(checkPlaybook(pb({ requires: '\n  skills:\n    - github' }), known)[0].code, 'E-PB05');
  assert.equal(checkPlaybook(pb({ 'disable-model-invocation': 'true' }), known)[0].code, 'E-PB06');
  assert.deepEqual(checkPlaybook(pb({ 'disable-model-invocation': 'false' }), known), [], 'explicit false is fine');
  const dm = (v) => new Map([['disable-model-invocation', { key: 'disable-model-invocation', value: v, line: 3 }]]);
  assert.equal(checkInvocation('startcycle-graph', dm('true'))[0].code, 'E-DMI01');
  assert.deepEqual(checkInvocation('startcycle-graph', dm('false')), []);
  assert.deepEqual(checkInvocation('bdb-updater', dm('true')), [], 'unlisted skills may keep the flag');
  assert.deepEqual(checkInvocation('startcycle', new Map()), []);
  assert.deepEqual(checkPlaybook(pb({}, ['kind', 'trigger', 'inputs', 'requires', 'go_points', 'outputs', 'verify', 'difficulty', 'est_time']), known).length, 0, 'no kind, no playbook rules');
  assert.deepEqual(
    checkPlaybook(pb({ requires: '\n  skills: ["gh (external)", github,]' }), known), [],
    'quoted item and trailing comma survive',
  );

  // W-MODEL01: fixed model names are warnings, tiers are not, and an
  // anti-example fence is deliberate.
  const modelHit = checkModelNames('Use gpt-4o for extraction.');
  assert.equal(modelHit.length, 1);
  assert.equal(modelHit[0].code, 'W-MODEL01');
  assert.ok(!MODEL_NAME_RE.test('Run it through llama.cpp or Ollama.'));
  assert.ok(MODEL_NAME_RE.test('GPT-4'), 'uppercase GPT-4 is still a fixed model name');
  assert.ok(MODEL_NAME_RE.test('Llama 3'), 'spaced llama is a fixed model name');
  assert.ok(MODEL_NAME_RE.test('--model sonnet'), '`--model sonnet` pins a tier alias');
  assert.ok(MODEL_NAME_RE.test('text-embedding-3-small'));
  assert.ok(MODEL_NAME_RE.test('Mixtral 8x7B'));
  assert.ok(MODEL_NAME_RE.test('Qwen2'));
  assert.ok(MODEL_NAME_RE.test('gemma-4-26b-a4b-it'));
  assert.ok(!MODEL_NAME_RE.test('Claude Code'), 'the CLI name `Claude Code` is not a model');
  assert.ok(!MODEL_NAME_RE.test('the words opus and sonnet alone in prose are fine'));
  assert.ok(!MODEL_NAME_RE.test('codebase-graph'));
  assert.deepEqual(checkModelNames('Use a reasoning-capable model via process.env.MODEL.'), []);
  assert.deepEqual(checkModelNames('``` anti-example\ndeliberately shows the forbidden model="gpt-4o" literal\n```'), []);
  assert.equal(
    checkModelNames('```\nplain fence keeps the check active: model="gpt-4o"\n```').length, 1,
    'a fence not marked anti-example is still checked',
  );

  // W-BRAND01: BDB brand tokens flagged, allowlisted paths and neutral text not.
  assert.equal(checkBrandTokens('accent #9B30C4 only', 'skills/x/SKILL.md')[0].code, 'W-BRAND01');
  assert.equal(checkBrandTokens('use Obsidian Black', 'agents/a.md').length, 1);
  assert.equal(checkBrandTokens('Vibrant Orchid', 'skills/x/SKILL.md').length, 1);
  assert.deepEqual(checkBrandTokens('#9b30c4', 'skills/global_config/plan-canvas/ui.js'), []);
  assert.deepEqual(checkBrandTokens('the project\'s declared accent token', 'skills/x/SKILL.md'), []);

  console.log('✓ selftest passed');
}

// ------------------------------------------------------------------------ main

// Guarded so tests can import the exported check functions without the CLI
// run (and its process.exit) firing on import.
const runningAsMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (runningAsMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) { selftest(); process.exit(0); }

  const { findings, counts } = validate();
  process.exit(report(findings, counts, {
    json: argv.includes('--json'),
    quiet: argv.includes('--quiet'),
    strict: argv.includes('--strict'),
  }));
}
