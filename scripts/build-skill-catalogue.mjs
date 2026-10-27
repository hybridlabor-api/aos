#!/usr/bin/env node
// Regenerates the full skill catalogue block of ask-tim from the SKILL.md frontmatter of every shipped skill.
// `--check` fails (exit 1) when the committed block differs; run without it to rewrite.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localSkillsFrom } from '../lib/store-shared.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'skills', 'global_config', 'ask-tim', 'SKILL.md');
const START = '<!-- aos:skill-catalogue:start -->';
const END = '<!-- aos:skill-catalogue:end -->';

const field = (text, key) => {
  const m = text.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
  if (!m) return '';
  let v = m[1].trim();
  if (/^[>|][-+]?$/.test(v)) {
    const rest = text.slice(m.index + m[0].length).split(/\r?\n/).slice(1);
    const lines = [];
    for (const l of rest) { if (/^\s+\S/.test(l)) lines.push(l.trim()); else break; }
    v = lines.join(' ');
  }
  return v.replace(/^["']|["']$/g, '');
};

const short = (d) => {
  const first = d.replace(/\bBDB\b/g, 'AOS').split(/(?<=\.)\s/)[0].replace(/\.$/, '');
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}...` : first;
};

export function buildCatalogue() {
  const byCat = new Map();
  for (const [name, file] of localSkillsFrom(join(root, 'skills'))) {
    const text = readFileSync(file, 'utf8');
    const cat = field(text, 'category') || 'library';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push([name, short(field(text, 'description'))]);
  }
  const out = ['## All shipped skills', '', 'Generated from the SKILL.md frontmatter of every shipped skill by the catalogue build step of this repository; do not edit by hand. Search it with `aos store search <words>`.', ''];
  for (const cat of [...byCat.keys()].sort()) {
    out.push(`### ${cat}`, '');
    for (const [n, d] of byCat.get(cat).sort(([a], [b]) => a.localeCompare(b))) out.push(`- \`${n}\`${d ? ` - ${d}` : ''}`);
    out.push('');
  }
  return out.join('\n');
}

export function apply(text) {
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  const block = `${START}\n${buildCatalogue()}${END}`;
  if (a === -1 || b === -1) return `${text.trimEnd()}\n\n---\n\n${block}\n`;
  return text.slice(0, a) + block + text.slice(b + END.length);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cur = readFileSync(target, 'utf8');
  const next = apply(cur);
  if (process.argv.includes('--check')) {
    if (cur !== next) { console.error('ask-tim skill catalogue is out of date. Run: node scripts/build-skill-catalogue.mjs'); process.exit(1); }
    console.log('ask-tim skill catalogue is up to date.');
  } else {
    writeFileSync(target, next);
    console.log(cur === next ? 'No changes.' : 'Updated ask-tim skill catalogue.');
  }
}
