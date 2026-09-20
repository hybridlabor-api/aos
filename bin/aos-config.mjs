#!/usr/bin/env node
// Machine-level AOS configuration: ~/.agents/aos-config.json
//
//   aos-config show                 print the current configuration
//   aos-config propose              suggest values from this machine's layout
//   aos-config set <key> <value>    workspaceRoot | userId | domains (comma-separated)
//
// Nothing here ships with a value. AOS is a public package, so the domain
// vocabulary cannot be baked in — one person's `web, media, infra` is
// meaningless on someone else's machine. `propose` reads the actual workspace
// and offers what it finds; the user decides what is real.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
export const CONFIG_PATH = path.join(HOME, '.agents', 'aos-config.json');

const DEFAULTS = { workspaceRoot: null, domains: [], userId: null };

export function load() {
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}

export function save(config) {
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  return CONFIG_PATH;
}

export const isConfigured = () => {
  const c = load();
  return Boolean(c.workspaceRoot && c.domains.length);
};

/** Where a project's path says it belongs, or null if it sits outside the root. */
export function domainFor(projectPath, config = load()) {
  if (!config.workspaceRoot) return null;
  const root = path.resolve(config.workspaceRoot.replace(/^~/, HOME));
  const rel = path.relative(root, path.resolve(projectPath));
  if (!rel || rel.startsWith('..')) return null;
  const first = rel.split(path.sep)[0];
  return config.domains.includes(first) ? first : null;
}

/** Read the machine rather than guess: the workspace root's own subdirectories. */
export function propose() {
  const candidates = [path.join(HOME, 'dev'), path.join(HOME, 'Projects'), path.join(HOME, 'src'), path.join(HOME, 'code')];
  const root = candidates.find((c) => existsSync(c) && statSync(c).isDirectory()) || null;

  let domains = [];
  if (root) {
    domains = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !['node_modules', 'archive', '_archive'].includes(e.name))
      .map((e) => e.name)
      .sort();
  }
  return {
    workspaceRoot: root ? root.replace(HOME, '~') : null,
    domains,
    userId: null,   // memB's user_id — asked for, never invented
  };
}

import { pathToFileURL } from 'node:url';

// ------------------------------------------------------------------- CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, key, ...rest] = process.argv.slice(2);
  const value = rest.join(' ');

  if (cmd === 'show') {
    const c = load();
    console.log(existsSync(CONFIG_PATH) ? CONFIG_PATH.replace(HOME, '~') : `${CONFIG_PATH.replace(HOME, '~')} (nicht vorhanden)`);
    console.log(JSON.stringify(c, null, 2));
    console.log(isConfigured() ? '\nvollständig' : '\nunvollständig — /aos-setup führt durch die Einrichtung');
  } else if (cmd === 'propose') {
    console.log(JSON.stringify(propose(), null, 2));
  } else if (cmd === 'set' && key) {
    const c = load();
    if (key === 'domains') c.domains = value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (key in DEFAULTS) c[key] = value || null;
    else { console.error(`unbekannter Schlüssel: ${key}`); process.exit(1); }
    console.log(`geschrieben: ${save(c).replace(HOME, '~')}`);
  } else {
    console.error('aos-config show | propose | set <workspaceRoot|userId|domains> <wert>');
    process.exit(1);
  }
}
