#!/usr/bin/env node
// Usage: node scripts/build-scenario-store-index.mjs <path-to-local-clone> <commit>
// Offline: reads blobs of <commit> from the local clone with git; never touches the network and never runs anything from it.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = join(ROOT, 'lib', 'scenario-store-index.json');
const CAP = 300 * 1024;
const SOURCE = {
  id: 'scenario', label: 'Scenario', upstream: 'https://github.com/scenario-labs/skills',
  raw_base: 'https://raw.githubusercontent.com/scenario-labs/skills',
  license: 'MIT', copyright: 'Copyright (c) 2026 Scenario', third_party: true,
};

// Starter set (production_artifacts/09 section 4, minus skills whose dependencies are outside the set).
// Excluded: scenario-blender-rigging (bx_rig.mannequin imports scenario-blender-sculpting), scenario-unity-2d (SKILL.md
// names scenario-sprite-pipeline, which does not exist upstream), scenario-text-overlay (Scenario MCP workflow, chevron + network font fetch).
const BLENDER = 'scenario-blender-expert';
const UNITY = 'scenario-unity-expert';
const SET = {
  [BLENDER]: { dir: 'skills/dcc/blender', category: 'media-eventtech' },
  'scenario-blender-retopology': { dir: 'skills/dcc/blender', category: 'media-eventtech', requires: [BLENDER] },
  'scenario-blender-uv-baking': { dir: 'skills/dcc/blender', category: 'media-eventtech', requires: [BLENDER] },
  'scenario-blender-texturing-shading': { dir: 'skills/dcc/blender', category: 'media-eventtech', requires: [BLENDER] },
  'scenario-blender-hard-surface': { dir: 'skills/dcc/blender', category: 'media-eventtech', requires: [BLENDER] },
  'scenario-blender-lighting-rendering': { dir: 'skills/dcc/blender', category: 'media-eventtech', requires: [BLENDER] },
  'scenario-blender-animation': { dir: 'skills/dcc/blender', category: 'media-eventtech', requires: [BLENDER] },
  'scenario-blender-geometry-nodes': { dir: 'skills/dcc/blender', category: 'media-eventtech', requires: [BLENDER] },
  [UNITY]: { dir: 'skills/game-engines/unity', category: 'media-eventtech' },
  'scenario-unity-performance': { dir: 'skills/game-engines/unity', category: 'engineering-method', requires: [UNITY] },
  'scenario-unity-pipeline-automation': { dir: 'skills/game-engines/unity', category: 'engineering-method', requires: [UNITY] },
  'scenario-unity-shaders': { dir: 'skills/game-engines/unity', category: 'media-eventtech', requires: [UNITY] },
  'scenario-unity-ui': { dir: 'skills/game-engines/unity', category: 'design-ui-ux', requires: [UNITY] },
};

const [cloneArg, commit] = process.argv.slice(2);
if (!cloneArg || !/^[a-f0-9]{40}$/.test(commit || '')) {
  console.error('Usage: build-scenario-store-index.mjs <clone-path> <40-hex-commit>');
  process.exit(2);
}
const clone = resolve(cloneArg);
const git = (args, opts = {}) => execFileSync('git', ['-C', clone, ...args], { maxBuffer: 64 << 20, ...opts });
if (git(['rev-parse', `${commit}^{commit}`], { encoding: 'utf8' }).trim() !== commit) throw new Error('commit not found in clone');
const hash = (data) => createHash('sha256').update(data).digest('hex');

function frontmatterValue(text, key) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return '';
  const lines = match[1].split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${key}:`, 'i').test(line));
  if (start < 0) return '';
  const first = lines[start].slice(lines[start].indexOf(':') + 1).trim();
  if (first && !/^[>|][-+]?$/.test(first)) return first.replace(/^['"]|['"]$/g, '');
  const values = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i] && !/^\s/.test(lines[i])) break;
    values.push(lines[i].trim());
  }
  return values.join(' ').trim();
}

function skillFiles(dir) {
  return git(['ls-tree', '-r', '-z', commit, `${dir}/`]).toString('latin1').split('\0').filter(Boolean).map((line) => {
    const [meta, path] = line.split('\t');
    const [mode, kind, oid] = meta.split(' ');
    if (kind !== 'blob' || mode === '120000') throw new Error(`Unsupported entry in ${dir}: ${line}`);
    const data = git(['cat-file', 'blob', oid]);
    return { path: path.slice(dir.length + 1), sha256: hash(data), size: data.length, exec: mode === '100755', data };
  }).sort((a, b) => (a.path < b.path ? -1 : 1));
}

// Audit detectors run on every script (files under scripts/). execBridge = a file that both executes code it
// receives (exec/eval/runtime compile/reflective invoke) and has a receive channel (socket, server, inbox).
const EXEC = [
  [/(^|[^\w.])(exec|eval)\s*\(/m, 'calls exec()/eval()'],
  [/\b(CSharpScript|CSharpCodeProvider|CompileAssemblyFromSource)\b/, 'compiles C# at runtime'],
  [/\.Invoke\(null, null\)/, 'invokes a method named in a request'],
  [/\bAssembly\.Load\b/, 'loads assemblies at runtime'],
];
const CHANNEL = [
  [/\b(HttpListener|TcpListener|UdpClient)\b/, 'network listener'],
  [/\.listen\s*\(|\.bind\s*\(|socketserver|http\.server|socket\.socket\(/, 'socket/server'],
  [/\binbox\b/i, 'file inbox polled for requests'],
];
const firstHit = (rules, text) => rules.find(([re]) => re.test(text))?.[1];

function audit(files) {
  const scripts = files.filter((f) => f.path.startsWith('scripts/'));
  const bridgeFiles = [];
  for (const f of scripts) {
    const text = f.data.toString('utf8');
    const exec = firstHit(EXEC, text);
    const channel = firstHit(CHANNEL, text);
    if (exec && channel) bridgeFiles.push({ path: f.path, reason: `${exec} + ${channel}` });
  }
  return { hasScripts: scripts.length > 0, scriptCount: scripts.length, execBridge: bridgeFiles.length > 0, execBridgeFiles: bridgeFiles };
}

const KNOWN_SOFTWARE = ['Blender', 'Unity'];
function software(description) {
  return KNOWN_SOFTWARE.flatMap((name) => {
    const m = description.match(new RegExp(`\\b${name}\\b(?:\\s(\\d+(?:\\.\\d+)+))?`));
    return m ? [m[1] ? `${name} ${m[1]}` : name] : [];
  });
}

const skills = {};
for (const [name, cfg] of Object.entries(SET)) {
  const dir = `${cfg.dir}/${name}`;
  const files = skillFiles(dir);
  const skillMd = files.find((f) => f.path === 'SKILL.md');
  if (!skillMd) throw new Error(`${name}: no SKILL.md in ${dir}`);
  const text = skillMd.data.toString('utf8');
  if ((frontmatterValue(text, 'name') || '').trim() !== name) throw new Error(`${name}: SKILL.md name differs from directory`);
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Invalid store name: ${name}`);
  const description = frontmatterValue(text, 'description').replace(/\s+/g, ' ').trim();
  skills[name] = {
    description: description.length > 100 ? `${description.slice(0, 99)}…` : description,
    category: cfg.category,
    tier: 'free',
    origin: 'scenario',
    requires_auth: false,
    sha256: skillMd.sha256,
    upstream_path: `${dir}/SKILL.md`,
    ...(cfg.requires ? { requires: cfg.requires } : {}),
    software: software(description),
    ...audit(files),
    files: files.map(({ data, ...rest }) => rest),
  };
}
for (const [name, item] of Object.entries(skills)) {
  for (const dep of item.requires || []) if (!skills[dep]) throw new Error(`${name} requires ${dep}, which is not in the set`);
}

const index = {
  version: '1.1.0',
  generated_at: git(['show', '-s', '--format=%cI', commit], { encoding: 'utf8' }).trim(),
  pinned_commit: commit,
  source: SOURCE,
  harness_support: ['claude', 'antigravity', 'codex', 'cursor', 'roo'],
  skills: Object.fromEntries(Object.entries(skills).sort(([a], [b]) => a.localeCompare(b))),
  subagents: {},
};
const output = JSON.stringify(index) + '\n';
if (Buffer.byteLength(output) >= CAP) throw new Error(`Store index exceeds 300 KB: ${Buffer.byteLength(output)} bytes`);
writeFileSync(OUTPUT_PATH, output);
for (const [name, item] of Object.entries(skills)) {
  console.log(`${name}\t${item.category}\tfiles=${item.files.length}\tscripts=${item.scriptCount}\texecBridge=${item.execBridge}\t${item.execBridgeFiles.map((f) => `${f.path} (${f.reason})`).join('; ')}`);
}
console.log(`Wrote ${OUTPUT_PATH} with ${Object.keys(skills).length} skills (${Buffer.byteLength(output)} bytes).`);
