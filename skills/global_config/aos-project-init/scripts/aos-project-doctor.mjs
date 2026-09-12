#!/usr/bin/env node
// AOS project doctor: reports how completely one project folder is wired into
// AOS. Read-only — it never installs or edits anything.
//   node aos-project-doctor.mjs [dir] [--json]

import { existsSync, readFileSync, lstatSync, readlinkSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2).filter((a) => a !== '--json');
const JSON_OUT = process.argv.includes('--json');
const ROOT = path.resolve(args[0] || process.cwd());
const PROJECT = path.basename(ROOT);
const HOME = os.homedir();

const results = [];
const add = (area, name, ok, detail, fix) => results.push({ area, name, ok, detail, fix });
const p = (...rel) => path.join(ROOT, ...rel);
const git = (...a) => { try { return execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

// ---------------------------------------------------------------- git
function checkGit() {
  const inRepo = git('rev-parse', '--is-inside-work-tree') === 'true';
  add('git', 'repository', inRepo, inRepo ? git('rev-parse', '--show-toplevel').replace(HOME, '~') : 'not a git repo',
    'git init && git add -A && git commit -m "chore: initial commit"');
  if (!inRepo) return;

  const remote = git('remote', 'get-url', 'origin');
  add('git', 'origin remote', !!remote, remote || 'local-only (fine for a scratch project, blocks gh/CI)',
    'gh repo create <name> --private --source=. --remote=origin');

  if (remote && remote.includes('github.com')) {
    let vis = null;
    try {
      vis = execFileSync('gh', ['repo', 'view', '--json', 'visibility', '-q', '.visibility'], { cwd: ROOT, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { /* gh missing or not authenticated */ }
    add('git', 'repo is private', vis === 'PRIVATE', vis ? `visibility: ${vis}` : 'could not read visibility (gh missing or unauthenticated)',
      'gh repo edit --visibility private --accept-visibility-change-consequences');
  }

  const ignore = existsSync(p('.gitignore')) ? readFileSync(p('.gitignore'), 'utf8') : '';
  add('git', '.gitignore covers .env', /(^|\n)\s*\.?\*?\.env/.test(ignore), ignore ? '.gitignore present' : 'no .gitignore',
    'Add `.env` and `*.env` to .gitignore; keep live secrets outside the repo.');
}

// ---------------------------------------------------------------- agent docs
function checkAgentDocs() {
  const agents = p('AGENTS.md');
  add('docs', 'AGENTS.md', existsSync(agents), existsSync(agents) ? `${readFileSync(agents, 'utf8').split('\n').length} lines` : 'missing — no repo-specific agent rules',
    'Write AGENTS.md (see the /aos-project-init template).');

  for (const alias of ['CLAUDE.md', 'GEMINI.md', 'CODEX.md']) {
    const f = p(alias);
    let ok = false; let detail = 'missing';
    if (existsSync(f)) {
      const isLink = lstatSync(f).isSymbolicLink();
      const target = isLink ? readlinkSync(f) : null;
      ok = isLink && path.basename(target) === 'AGENTS.md';
      detail = isLink ? `-> ${target}` : 'a real file, not a symlink (will drift from AGENTS.md)';
    }
    add('docs', alias, ok, detail, `ln -sf AGENTS.md ${alias}`);
  }
}

// ---------------------------------------------------------------- harness
function checkHarness() {
  for (const [rel, what] of [
    ['.agents/graph.md', 'dispatcher-graph contract'],
    ['.agents/nodes.json', 'node registry'],
    ['.claude/workflows', 'dispatcher workflow'],
    ['.claude/hooks/go-gate.mjs', 'release gate hook'],
    ['.claude/agents', 'agent definitions'],
    ['.claude/settings.json', 'project hook wiring'],
  ]) {
    add('harness', rel, existsSync(p(rel)), existsSync(p(rel)) ? what : `missing — ${what} unavailable here`,
      'npx -y @hybridlabor-api/aos --project-harness   (run inside the project)');
  }
}

// ---------------------------------------------------------------- openwiki
function checkWiki() {
  const dir = p('.openwiki');
  const pages = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
  add('openwiki', 'wiki initialised', pages.length > 0, pages.length ? `${pages.length} pages: ${pages.slice(0, 4).join(', ')}${pages.length > 4 ? ' …' : ''}` : 'no .openwiki pages',
    'openwiki --init   (run inside the project; needs `openwiki auth <provider>` first)');
}

// ---------------------------------------------------------------- memB
async function checkMemb() {
  const dbPath = path.join(HOME, '.MemBDB', 'memb.db');
  if (!existsSync(dbPath)) {
    add('memB', 'project memories', false, 'no memB store on this machine', 'Run /aos-setup first.');
    return;
  }
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 5000;');
    const row = db.prepare(`
      SELECT COUNT(*) AS n FROM memb_vectors
      WHERE json_extract(payload, '$.project_id') = ?
         OR json_extract(payload, '$.metadata.project_id') = ?
    `).get(PROJECT, PROJECT);
    const n = Number(row?.n || 0);
    add('memB', 'project memories', n > 0, `${n} memories bound to project_id "${PROJECT}"`,
      'Ingest the project: python3 memb_ingest.py <project dir>  (see /aos-project-init, section 5)');
  } catch (e) {
    add('memB', 'project memories', false, `could not read the store (${e.message.split('\n')[0]})`,
      'node:sqlite is unflagged only from Node 22.13; on 22.5-22.12 upgrade Node (or pass --experimental-sqlite). Otherwise inspect via the memB WebUI on :8088.');
  }
}

// ---------------------------------------------------------------- report
function report() {
  if (JSON_OUT) {
    console.log(JSON.stringify({ project: PROJECT, root: ROOT.replace(HOME, '~'), ok: results.every((r) => r.ok), results }, null, 2));
    return;
  }
  console.log(`\nProject: ${PROJECT}  (${ROOT.replace(HOME, '~')})`);
  let area = '';
  for (const r of results) {
    if (r.area !== area) { area = r.area; console.log(`\n${area.toUpperCase()}`); }
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(24)} ${r.detail}`);
    if (!r.ok) console.log(`     ↳ fix: ${r.fix}`);
  }
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} checks pass.` + (bad.length ? ` ${bad.length} need attention.` : ' Project is fully wired.'));
}

checkGit();
checkAgentDocs();
checkHarness();
checkWiki();
await checkMemb();
report();
process.exit(results.some((r) => !r.ok) ? 1 : 0);
