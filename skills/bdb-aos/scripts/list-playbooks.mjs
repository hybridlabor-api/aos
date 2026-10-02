#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const unquote = (s) => s.trim().replace(/^["']|["']$/g, '');

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  let key = null;
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const top = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (top) {
      key = top[1];
      out[key] = /^(>-?|\|-?)$/.test(top[2]) ? '' : top[2];
    } else if (key && line.trim()) out[key] = `${out[key]} ${line.trim()}`.trim();
  }
  return out;
}

const flowList = (value, name) => {
  const m = new RegExp(`(?:^|[\\s{,])${name}:\\s*\\[([^\\]]*)\\]`).exec(value ?? '');
  return m ? m[1].split(',').map(unquote).filter(Boolean) : [];
};

export function listPlaybooks(skillsRoot) {
  const found = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name === 'SKILL.md' && /^pb-/.test(dirname(full).split(sep).pop())) {
        const fm = frontmatter(readFileSync(full, 'utf8'));
        const req = fm.requires ?? '';
        found.push({
          name: unquote(fm.name ?? ''),
          description: unquote(fm.description ?? ''),
          est_time: unquote(fm.est_time ?? ''),
          difficulty: unquote(fm.difficulty ?? ''),
          requires: {
            skills: flowList(req, 'skills'), agents: flowList(req, 'agents'),
            mcps: flowList(req, 'mcps'), store: flowList(req, 'store'),
          },
        });
      }
    }
  };
  if (existsSync(skillsRoot)) visit(skillsRoot);
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export const requiresLabel = (r) => [...r.skills, ...r.agents.map((a) => `agent:${a}`), ...r.mcps.map((m) => `mcp:${m}`), ...r.store.map((s) => `store:${s}`)].join(', ');

function defaultRoot() {
  const parts = dirname(fileURLToPath(import.meta.url)).split(sep);
  const i = parts.lastIndexOf('skills');
  return i < 0 ? resolve('skills') : parts.slice(0, i + 1).join(sep);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? defaultRoot();
  const list = listPlaybooks(root);
  if (process.argv.includes('--json')) console.log(JSON.stringify(list, null, 2));
  else {
    for (const p of list) {
      console.log(`${p.name}\t${p.est_time}\t${p.difficulty}\trequires: ${requiresLabel(p.requires) || 'nothing'}`);
      console.log(`  ${p.description}`);
    }
    console.log(`\n${list.length} playbook(s).`);
  }
}
