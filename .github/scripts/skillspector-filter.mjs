#!/usr/bin/env node
// Filters SkillSpector JSON reports against the baseline and decides pass/fail.
// Usage: node skillspector-filter.mjs <reports-dir> <baseline.json> <enforce-from YYYY-MM-DD>
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOCKING = new Set(['HIGH', 'CRITICAL']);
const sev = (i) => String(i.severity ?? '').toUpperCase();

export function evaluate({ reports, baseline, enforceFrom, today }) {
  const kept = [];
  const suppressed = [];
  for (const { skill, data } of reports) {
    for (const issue of data.issues ?? []) {
      const known = baseline.some(
        (b) => b.skill === skill && (b.rule === issue.id || b.rule === issue.category),
      );
      (known ? suppressed : kept).push({ skill, issue });
    }
  }
  const blocking = kept.filter(({ issue }) => BLOCKING.has(sev(issue)));
  const enforcing = today >= enforceFrom;
  return { kept, suppressed, blocking, enforcing, fail: enforcing && blocking.length > 0 };
}

const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export function render(result) {
  const lines = result.kept.map(({ skill, issue }) => {
    const loc = issue.location?.file ? `${issue.location.file}:${issue.location.start_line ?? 1}` : '';
    return `| ${skill} | ${sev(issue)} | ${issue.id ?? ''} | ${issue.category ?? ''} | ${loc} |`;
  });
  const summary = [
    '## SkillSpector (static, --no-llm)',
    `Findings: ${result.kept.length} (blocking high+: ${result.blocking.length}), baseline-suppressed: ${result.suppressed.length}`,
    result.enforcing ? 'Mode: enforcing' : 'Mode: warn-only',
    '',
    ...(lines.length ? ['| Skill | Severity | Rule | Category | Location |', '|---|---|---|---|---|', ...lines] : ['No findings.']),
  ].join('\n');
  const annotations = result.kept.map(({ skill, issue }) => {
    const f = issue.location?.file ? `,file=${esc(issue.location.file)},line=${issue.location.start_line ?? 1}` : '';
    return `::warning title=SkillSpector ${esc(sev(issue))}${f}::${esc(`${skill}: ${issue.id ?? issue.category}`)}`;
  });
  return { summary, annotations };
}

function main() {
  const [dir, baselinePath, enforceFrom] = process.argv.slice(2);
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const reports = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      skill: f.slice(0, -5).replaceAll('__', '/'),
      data: JSON.parse(readFileSync(join(dir, f), 'utf8')),
    }));
  const today = new Date().toISOString().slice(0, 10);
  const result = evaluate({ reports, baseline, enforceFrom, today });
  const { summary, annotations } = render(result);
  console.log(annotations.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  else console.log(summary);
  if (result.fail) {
    console.log(`::error::SkillSpector: ${result.blocking.length} high+ finding(s) not in baseline (enforcing since ${enforceFrom})`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
