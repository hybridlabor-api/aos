import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export function localSkills(root) {
  const found = new Map();
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.name === 'SKILL.md') found.set(basename(dirname(fullPath)), fullPath);
    }
  };
  visit(join(root, 'skills'));
  return found;
}

export function localAgents(root) {
  const found = new Map();
  for (const dir of [join(root, '.claude', 'agents'), join(root, '.agents', 'agents'), join(root, 'agents')]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) found.set(entry.replace(/\.md$/i, ''), join(dir, entry));
  }
  return found;
}

export function globalRoots(type) {
  const home = homedir();
  const sub = type === 'skills' ? 'skills' : 'agents';
  return [
    join(home, '.agents', sub),
    join(home, '.claude', sub),
    join(home, '.codex', sub),
    join(home, '.cursor', sub),
    join(home, '.roo', sub),
    join(home, '.gemini', 'config', sub),
  ];
}

export function targetsFor(type, name, { project = false, cwd = process.cwd() } = {}) {
  if (project) {
    return type === 'skills'
      ? [join(cwd, 'skills', name, 'SKILL.md')]
      : [join(cwd, 'agents', `${name}.md`)];
  }
  return globalRoots(type).map((root) => (type === 'skills'
    ? join(root, name, 'SKILL.md')
    : join(root, `${name}.md`)));
}
