#!/usr/bin/env node
// Regenerates the Skills, Playbooks, Subagents and Slash commands parts of the README catalog block
// (README.md, README.de.md, README.pt.md) from the plugin manifest, agents/ and commands/.
// Harnesses, Tools and MCP servers stay hand-written. A row that already exists keeps its curated
// description; new rows take the first sentence of the source description.
// Usage: node scripts/gen-readme-catalog.mjs [--check]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['README.md', 'README.de.md', 'README.pt.md'];
const START = '<details>\n<summary><b>Skills (';
const END = '<!-- END GENERATED CATALOG -->';

const front = (text, key) => {
    const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
};
const short = (d) => {
    const s = d.replace(/\s+/g, ' ').replace(/\|/g, '\\|');
    const first = s.match(/^.+?[.!?](?=\s|$)/);
    const out = first ? first[0] : s;
    return out.length > 160 ? out.slice(0, 157).trimEnd() + '...' : out;
};

function sources() {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'plugins/bdb-aos/.claude-plugin/plugin.json'), 'utf8'));
    const skills = [], playbooks = [];
    for (const rel of manifest.skills) {
        const text = readFileSync(join(ROOT, 'plugins/bdb-aos', rel, 'SKILL.md'), 'utf8');
        const name = basename(rel);
        const row = { name, desc: front(text, 'description'), category: front(text, 'category') || 'library' };
        (name.startsWith('pb-') ? playbooks : skills).push(row);
    }
    const md = (dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.md')).sort()
        .map((f) => ({ name: f.slice(0, -3), desc: front(readFileSync(join(ROOT, dir, f), 'utf8'), 'description') }));
    return { skills, playbooks, agents: md('agents'), commands: md('commands') };
}

function render(src, curated) {
    const desc = (name, d) => curated.get(name) || short(d);
    const table = (head, rows, fmt = (n) => `\`${n}\``) =>
        `| ${head} | What it does |\n|---|---|\n` + rows.slice().sort((a, b) => a.name.localeCompare(b.name)).map((r) => `| ${fmt(r.name)} | ${desc(fmt(r.name), r.desc)} |`).join('\n') + '\n';
    const block = (title, body) => `<details>\n<summary><b>${title}</b></summary>\n\n${body}\n</details>\n`;
    const byCat = new Map();
    for (const s of src.skills) byCat.set(s.category, [...(byCat.get(s.category) || []), s]);
    const cats = [...byCat].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const skillBody = cats.map(([c, rows]) => block(`${c} (${rows.length})`, table('Skill', rows))).join('\n');
    return [
        block(`Skills (${src.skills.length})`, skillBody),
        block(`Playbooks (${src.playbooks.length})`, table('Playbook', src.playbooks)),
        block(`Subagents (${src.agents.length})`, table('Agent', src.agents)),
        block(`Slash commands (${src.commands.length})`, table('Command', src.commands, (n) => `\`/${n}\``)),
    ].join('\n') + '\n';
}

const check = process.argv.includes('--check');
const src = sources();
let stale = 0;
for (const f of FILES) {
    const path = join(ROOT, f);
    const text = readFileSync(path, 'utf8');
    const a = text.indexOf(START), b = text.indexOf(END);
    if (a < 0 || b < a) throw new Error(`${f}: catalog markers not found`);
    const old = text.slice(a, b);
    const curated = new Map([...old.matchAll(/^\| (`[^`]+`) \| (.+) \|$/gm)].map((m) => [m[1], m[2]]));
    const next = text.slice(0, a) + render(src, curated) + '\n' + text.slice(b);
    if (next !== text) { stale++; if (!check) writeFileSync(path, next); }
}
if (check && stale) { console.error(`${stale} README catalog(s) out of date: run node scripts/gen-readme-catalog.mjs`); process.exit(1); }
console.log(`${check ? 'checked' : 'wrote'} ${FILES.length} READMEs: ${src.skills.length} skills, ${src.playbooks.length} playbooks, ${src.agents.length} agents, ${src.commands.length} commands`);
