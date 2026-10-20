// Shared help for every AOS CLI. The data lives in lib/cli-specs/ (one spec object per CLI); this module renders it.
// Pure: importing it has no side effect. The early guard is lib/cli-help-guard.mjs.
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import SPECS from './cli-specs/index.mjs';

export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const loadSpecs = () => SPECS;

const HELP_WORDS = new Set(['help', '-h', '--help']);

// Arguments after a literal `--` belong to a wrapped command (aos-mcp-env), never to us.
const ours = (argv) => { const i = argv.indexOf('--'); return i < 0 ? argv : argv.slice(0, i); };

export function wantsHelp(argv) {
  const a = ours(argv);
  return a.length > 0 && (HELP_WORDS.has(a[0]) || a.includes('--help') || a.includes('-h'));
}

export const wantsJson = (argv) => ours(argv).includes('--json');

const pad = (s, n) => (s.length >= n ? `${s} ` : s.padEnd(n));

function block(title, rows) {
  if (!rows.length) return [];
  const w = Math.min(34, Math.max(...rows.map((r) => r[0].length)) + 2);
  return ['', `${title}:`, ...rows.map(([k, v]) => `  ${pad(k, w)}${v}`)];
}

export function renderHelp(spec, cmd) {
  const c = cmd && (spec.commands || []).find((x) => x.name === cmd);
  if (c) {
    return [`${spec.name} ${c.name} - ${c.summary}`, '', 'Usage:', `  ${c.usage}`,
      ...block('Options', (spec.flags || []).map((f) => [f.arg ? `${f.name} ${f.arg}` : f.name, f.summary]))].join('\n');
  }
  const out = [`${spec.name} - ${spec.summary}`];
  if (spec.whenToUse) out.push('', `When to use: ${spec.whenToUse}`);
  if (spec.sideEffects) out.push(`Side effects: ${spec.sideEffects}`);
  out.push('', 'Usage:', ...(spec.usage || []).map((u) => `  ${u}`));
  out.push(...block('Commands', (spec.commands || []).map((x) => [x.name, x.summary])));
  out.push(...block('Options', (spec.flags || []).map((f) => [f.arg ? `${f.name} ${f.arg}` : f.name, f.summary])));
  out.push(...block('Environment', (spec.env || []).map((e) => [e.name, e.summary])));
  out.push(...block('Exit codes', (spec.exit || []).map((e) => [String(e.code), e.meaning])));
  if (spec.json) out.push('', `JSON: ${spec.json}`);
  if (spec.examples?.length) out.push('', 'Examples:', ...spec.examples.map((e) => `  ${e}`));
  out.push('', `Help: ${spec.name} --help [--json]; all CLIs: aos help --all [--json]`);
  return out.join('\n');
}

// Text or JSON help for one argv; the command word is the first non-flag argument that is not `help`.
export function helpFor(spec, argv) {
  if (wantsJson(argv)) return JSON.stringify(spec, null, 2);
  const word = ours(argv).find((a) => !a.startsWith('-') && a !== 'help');
  return renderHelp(spec, word);
}

export function findSpecByEntry(realEntry, specs = loadSpecs()) {
  return specs.find((s) => {
    try { return realpathSync(join(PKG_ROOT, s.entry)) === realEntry; } catch { return false; }
  }) || null;
}

export function helpAll({ json = false } = {}) {
  const specs = loadSpecs();
  if (json) return JSON.stringify({ version: 1, clis: specs }, null, 2);
  const rows = specs.map((s) => [s.name, s.whenToUse || s.summary]);
  const w = Math.max(...rows.map((r) => r[0].length)) + 2;
  return ['AOS CLIs (details: <cli> --help, or aos help <cli>; machine-readable: aos help --all --json)', '',
    ...rows.map(([k, v]) => `  ${k.padEnd(w)}${v}`)].join('\n');
}
