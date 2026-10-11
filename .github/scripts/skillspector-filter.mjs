#!/usr/bin/env node
// Filters SkillSpector JSON reports against the baseline and decides pass/fail.
// Usage: node skillspector-filter.mjs <reports-dir> <baseline.json> <enforce-from YYYY-MM-DD> [skill-dirs.txt]
// Reports are named <index>.json with an <index>.path sidecar mapping index -> skill dir below skills/.
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOCKING = new Set(['HIGH', 'CRITICAL']);
const sev = (i) => String(i.severity ?? '').toUpperCase();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Validates "YYYY-MM-DD" both in shape and as a real calendar date (e.g. "2026-21-10" must be rejected).
function validateEnforceDate(value) {
  if (!DATE_RE.test(value ?? '')) {
    throw Object.assign(
      new Error(`Invalid SKILLSPECTOR_ENFORCE_FROM: "${value}" (expected YYYY-MM-DD)`),
      { exitCode: 2 },
    );
  }
  const [ey, em, ed] = value.split('-').map(Number);
  const asDate = new Date(Date.UTC(ey, em - 1, ed));
  if (asDate.getUTCFullYear() !== ey || asDate.getUTCMonth() !== em - 1 || asDate.getUTCDate() !== ed) {
    throw Object.assign(
      new Error(`Invalid SKILLSPECTOR_ENFORCE_FROM: "${value}" (not a valid calendar date)`),
      { exitCode: 2 },
    );
  }
}

export function validateBaseline(baseline) {
  if (!Array.isArray(baseline)) throw new Error('Baseline must be a JSON array');
  baseline.forEach((entry, i) => {
    if (entry === null || typeof entry !== 'object') {
      throw new Error(`Baseline entry ${i} is not an object`);
    }
    for (const key of ['skill', 'id', 'reason']) {
      if (typeof entry[key] !== 'string' || entry[key] === '') {
        throw new Error(`Baseline entry ${i}: "${key}" must be a non-empty string`);
      }
    }
    if (entry.file !== undefined && typeof entry.file !== 'string') {
      throw new Error(`Baseline entry ${i}: "file" must be a string when present`);
    }
  });
}

export function matchesBaseline(issue, skillDir, baseline) {
  return baseline.some((b) => {
    if (b.id !== issue.id) return false;
    if (b.skill !== skillDir) return false;
    if (b.file !== undefined && b.file !== (issue.location?.file ?? '')) return false;
    return true;
  });
}

export function evaluate({ reports, baseline, enforceFrom, today }) {
  validateEnforceDate(enforceFrom);
  const kept = [];
  const suppressed = [];
  for (const { skill, data } of reports) {
    if (!Array.isArray(data.issues)) {
      const err = new Error(`Report for skill "${skill}" has no issues array`);
      err.exitCode = 2;
      throw err;
    }
    for (const issue of data.issues) {
      const known = matchesBaseline(issue, skill, baseline);
      (known ? suppressed : kept).push({ skill, issue });
    }
  }
  const blocking = kept.filter(({ issue }) => BLOCKING.has(sev(issue)));
  const enforcing = today >= enforceFrom;
  return { kept, suppressed, blocking, enforcing, fail: enforcing && blocking.length > 0 };
}

// Annotation properties: %, CR, LF, :, and , are percent-encoded (GitHub runner protocol).
// Message bodies: %, CR, LF only.
const escProp = (s) =>
  String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C');
const escMsg = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const code = (s) => '`' + String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\n/g, ' ').replace(/\|/g, '\\|') + '`';

export function render(result) {
  const lines = result.kept.map(({ skill, issue }) => {
    const loc = issue.location?.file
      ? `${issue.location.file}:${issue.location.start_line ?? 1}`
      : '';
    return `| ${code(skill)} | ${sev(issue)} | ${code(issue.id ?? '')} | ${code(loc)} |`;
  });
  const summary = [
    '## SkillSpector (static, --no-llm)',
    `Findings: ${result.kept.length} (blocking high+: ${result.blocking.length}), baseline-suppressed: ${result.suppressed.length}`,
    result.enforcing ? 'Mode: enforcing' : 'Mode: warn-only',
    '',
    ...(lines.length
      ? ['| Skill | Severity | Rule | Location |', '|---|---|---|---|', ...lines]
      : ['No findings.']),
  ].join('\n');
  const annotations = result.kept.map(({ skill, issue }) => {
    const f = issue.location?.file
      ? `,file=${escProp(issue.location.file)},line=${issue.location.start_line ?? 1}`
      : '';
    return `::warning title=${escProp(`SkillSpector ${sev(issue)}`)}${f}::${escMsg(`${skill}: ${issue.id ?? ''}`)}`;
  });
  return { summary, annotations };
}

function loadReports(dir) {
  const entries = readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)));
  return entries.map((f) => {
    const idx = f.slice(0, -5);
    let skill;
    try {
      skill = readFileSync(join(dir, `${idx}.path`), 'utf8').trim();
    } catch {
      throw Object.assign(new Error(`Missing sidecar ${idx}.path for report ${idx}.json`), { exitCode: 2 });
    }
    if (!skill) {
      throw Object.assign(new Error(`Empty sidecar ${idx}.path`), { exitCode: 2 });
    }
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      throw Object.assign(new Error(`Report ${idx}.json is not valid JSON`), { exitCode: 2 });
    }
    if (!Array.isArray(data.issues)) {
      throw Object.assign(new Error(`Report for skill "${skill}" has no issues array`), { exitCode: 2 });
    }
    return { skill, data };
  });
}

function main() {
  const [dir, baselinePath, enforceFrom, skillDirsPath] = process.argv.slice(2);
  // A malformed date must never silently disable enforcement: validate it before touching anything.
  try {
    validateEnforceDate(enforceFrom);
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(2);
  }
  let baseline;
  let reports;
  let result;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    validateBaseline(baseline);
    reports = loadReports(dir);
    const today = new Date().toISOString().slice(0, 10);
    result = evaluate({ reports, baseline, enforceFrom, today });
  } catch (err) {
    if (err && err.exitCode !== 2) err.exitCode = 2;
    console.error(`::error::${err && err.message ? err.message : String(err)}`);
    process.exit(2);
  }

  if (skillDirsPath) {
    const scanned = readFileSync(skillDirsPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^skills\//, ''))
      .sort();
    const reported = reports.map((r) => r.skill).sort();
    if (reported.length !== scanned.length || !scannerEqual(reported, scanned)) {
      console.error(`::error::Report count (${reported.length}) does not match scanned skill dirs (${scanned.length})`);
      process.exit(2);
    }
  }

  const { summary, annotations } = render(result);
  console.log(annotations.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  else console.log(summary);
  if (result.fail) {
    console.log(`::error::SkillSpector: ${result.blocking.length} high+ finding(s) not in baseline (enforcing since ${enforceFrom})`);
    process.exit(1);
  }
}

function scannerEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
