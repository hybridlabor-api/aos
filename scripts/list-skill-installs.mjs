#!/usr/bin/env node
// List install command lines for skills.sh, in priority tiers.
// Scans skills/**/SKILL.md, reads frontmatter name/category, prints
// lines. It only prints; it never launches any process.

import { readdir, readFile, stat, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(SCRIPT_DIR, '..');
const REPO_DEFAULT = 'hybridlabor-api/aos';
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const NAME_RE = /^[A-Za-z0-9_-]+$/;
const USAGE =
  'Usage: list-skill-installs [--root <dir>] [--repo <owner/slug>] [--json] [--tier <n>] [--out <file>] [--count]\n';

class UsageError extends Error {}

function usageError(message) {
  throw new UsageError(message);
}

function parseArgs(argv) {
  const opts = {
    root: DEFAULT_ROOT,
    repo: REPO_DEFAULT,
    json: false,
    tier: null,
    out: null,
    count: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--root':
        opts.root = argv[++i] ?? usageError('--root requires a value');
        break;
      case '--repo':
        opts.repo = argv[++i] ?? usageError('--repo requires a value');
        break;
      case '--json':
        opts.json = true;
        break;
      case '--tier': {
        const raw = argv[++i];
        const n = Number.parseInt(raw ?? '', 10);
        if (!raw || Number.isNaN(n) || n < 1 || n > 5 || String(n) !== raw) {
          usageError('--tier requires an integer from 1 to 5');
        }
        opts.tier = n;
        break;
      }
      case '--out':
        opts.out = argv[++i] ?? usageError('--out requires a value');
        break;
      case '--count':
        opts.count = true;
        break;
      default:
        usageError(`unknown argument: ${arg}`);
    }
  }
  if (!REPO_RE.test(opts.repo)) {
    usageError(`--repo must match ${REPO_RE.source}, got: ${opts.repo}`);
  }
  return opts;
}

// Minimal frontmatter reader: takes the YAML block between the first two
// `---` lines and extracts scalar `name:` and `category:` values. Folded
// descriptions (>- or |) are ignored; only name and category matter.
function readFrontmatterField(text, field) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = text.slice(3, end);
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m || m[1] !== field) continue;
    let value = m[2].trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (value === '') return null;
    return value;
  }
  return null;
}

async function findSkillMdFiles(skillsDir, out = []) {
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(skillsDir, entry.name);
    if (entry.isDirectory()) {
      await findSkillMdFiles(full, out);
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      out.push(full);
    }
  }
  return out;
}

async function collectSkills(root) {
  const skillsDir = join(root, 'skills');
  let rootStat;
  try {
    rootStat = await stat(skillsDir);
  } catch {
    return [];
  }
  if (!rootStat.isDirectory()) return [];

  const files = await findSkillMdFiles(skillsDir);
  const skills = [];
  const skipped = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const name = readFrontmatterField(text, 'name');
    const category = readFrontmatterField(text, 'category');
    if (name === null || !NAME_RE.test(name)) {
      skipped.push(file);
      continue;
    }
    skills.push({ name, category: category ?? '', path: file });
  }
  return { skills, skipped };
}

function tierOf(name, category) {
  if (name === 'fabric' || name.startsWith('fabric-')) return 1;
  if (category === 'bdb-core') return 2;
  if (name.startsWith('bdb-') || name.startsWith('aos-')) return 3;
  if (name.startsWith('pb-')) return 4;
  return 5;
}

function buildEntries(skills, repo) {
  const seen = new Set();
  const entries = [];
  for (const { name, category } of skills) {
    if (seen.has(name)) continue;
    seen.add(name);
    entries.push({
      tier: tierOf(name, category),
      name,
      category,
      command: `npx skills add ${repo} --skill ${name} -y`,
    });
  }
  return entries.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}

function linesFromEntries(entries) {
  return entries.map((e) => `${e.command}\n`);
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function main(argv = process.argv.slice(2), stdout = process.stdout, stderr = process.stderr) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      stderr.write(`list-skill-installs: ${err.message}\n`);
      stderr.write(USAGE);
      return 2;
    }
    throw err;
  }
  const { skills, skipped } = await collectSkills(opts.root);
  const entries = buildEntries(skills, opts.repo);
  const filtered = opts.tier === null ? entries : entries.filter((e) => e.tier === opts.tier);

  for (const file of skipped) {
    stderr.write(`list-skill-installs: skipped invalid skill name: ${file}\n`);
  }

  let output;
  if (opts.count) {
    const counts = new Map(
      [1, 2, 3, 4, 5]
        .filter((t) => opts.tier === null || t === opts.tier)
        .map((t) => [t, entries.filter((e) => e.tier === t).length])
    );
    output = [...counts.entries()].map(([t, n]) => `tier ${t}: ${n}\n`).join('');
  } else if (opts.json) {
    output = `${JSON.stringify(filtered.map(({ tier, name, category, command }) => ({ tier, name, category, command })), null, 2)}\n`;
  } else {
    output = linesFromEntries(filtered).join('');
  }

  if (opts.out) {
    if (await fileExists(opts.out)) {
      stderr.write(`list-skill-installs: refusing to overwrite existing file: ${opts.out}\n`);
      return 2;
    }
    await writeFile(opts.out, output, 'utf8');
  } else {
    stdout.write(output);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => {
      if (code !== 0) process.exit(code);
    })
    .catch((err) => {
      process.stderr.write(`list-skill-installs: ${err && err.message ? err.message : String(err)}\n`);
      process.stderr.write(USAGE);
      process.exit(2);
    });
}
