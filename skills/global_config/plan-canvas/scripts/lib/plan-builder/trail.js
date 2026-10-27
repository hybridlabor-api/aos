'use strict';

/**
 * Derive an agenttrail plan file (skills/global_config/agenttrail "Plan
 * convention") from a plan folder: `## Name {#id}` components with optional
 * `needs:` / `files:` / `by:` / `url:` lines and `- [ ] task {#id}` items.
 *
 * Sources, in document order: plan.mdx, canvas.mdx, prototype.mdx.
 * Components: headings tagged `{#id}` and `<Section id title>`.
 * needs: `<Section needs=[...]>`, or frontmatter `needs-<id>: a, b` for headings.
 * files: `<ImplementationMap files=...>`, `<Checklist files="a, b">`, or a plain
 *   `files: a, b` line in the section. by: `<Checklist by="opencode">` or a
 *   plain `by: opencode` line in the section.
 * Tasks: `<Checklist>` items.
 */

const fs = require('fs');
const path = require('path');

const { parseMdx } = require('./mdx');
const { checklistItems } = require('./render');

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const HEADING_ID_RE = /\s*\{#([A-Za-z0-9-]+)\}\s*$/;
const FILES_LINE_RE = /^files:\s*(.+?)\s*$/i;
const BY_LINE_RE = /^by:\s*(.+?)\s*$/i;
const DEFAULT_OUT = path.join('production_artifacts', '00_execution_plan.md');
const SOURCES = ['plan.mdx', 'canvas.mdx', 'prototype.mdx'];

class TrailError extends Error {}

const oneLine = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').replace(/\{#[^}]*\}/g, '').trim();

function toIdList(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return list.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function entryPath(entry) {
  if (typeof entry === 'string') return entry.trim();
  if (entry && typeof entry === 'object') return String(entry.path ?? entry.file ?? entry.name ?? '').trim();
  return '';
}

function implementationFiles(block) {
  const raw = block.props.files;
  let entries = [];
  if (Array.isArray(raw)) entries = raw;
  else if (raw && typeof raw === 'object') entries = Object.keys(raw);
  if (!entries.length) {
    entries = (block.children || []).filter((c) => c.type === 'prose')
      .flatMap((c) => c.text.split('\n')).map((l) => l.replace(/^\s*[-*]\s+/, '').trim());
  }
  return entries.map(entryPath).filter(Boolean);
}

// `files` values from a Checklist prop or a plain `files: a, b` line: an array,
// a comma string, optional `[...]` wrapper — file paths are case-sensitive, so
// nothing is lowercased here (unlike `needs` ids).
function declaredFiles(value) {
  if (Array.isArray(value)) return value.map(entryPath).filter(Boolean);
  if (typeof value !== 'string') return [];
  let text = value.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  return text.split(',').map((v) => v.trim()).filter(Boolean);
}

function addFiles(component, entries, warnings) {
  for (const file of entries) {
    if (/[,\[\]\n]/.test(file)) warnings.push(`skipped file with unsupported characters: ${file}`);
    else if (!component.files.includes(file)) component.files.push(file);
  }
}

function collect(dir) {
  const blocks = [];
  let frontmatter = null;
  for (const file of SOURCES) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) continue;
    const parsed = parseMdx(fs.readFileSync(full, 'utf8'));
    if (!frontmatter) frontmatter = parsed.frontmatter || {};
    blocks.push(...parsed);
  }
  return { blocks, frontmatter: frontmatter || {} };
}

function derive(dir, { workspaceRoot = process.cwd(), preserve = new Map() } = {}) {
  const { blocks, frontmatter } = collect(dir);
  const components = [];
  const used = new Set();
  const warnings = [];

  const uniqueId = (wanted, fallback) => {
    let base = ID_RE.test(String(wanted).toLowerCase()) ? String(wanted).toLowerCase() : slug(fallback) || 'item';
    if (!ID_RE.test(base)) base = `n-${base}`;
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    return id;
  };

  const open = (title, wantedId, needs) => {
    const component = { id: uniqueId(wantedId, title), title: oneLine(title) || wantedId, needs: toIdList(needs), files: [], by: '', url: '', tasks: [] };
    components.push(component);
    return component;
  };

  const walk = (list, current) => {
    let cur = current;
    for (const block of list) {
      if (block.type === 'heading') {
        const m = HEADING_ID_RE.exec(block.text);
        if (m && m[1].toLowerCase() !== 'board') {
          cur = open(block.text.replace(HEADING_ID_RE, ''), m[1], frontmatter[`needs-${m[1].toLowerCase()}`]);
        } else if (block.level <= 2) {
          cur = current;
        }
        continue;
      }
      if (block.type === 'prose' && cur) {
        // Section-level declarations, the plain markdown form: `files: a, b` and `by: opencode`.
        for (const line of block.text.split('\n')) {
          const trimmed = line.trim();
          let m;
          if ((m = FILES_LINE_RE.exec(trimmed))) addFiles(cur, declaredFiles(m[1]), warnings);
          else if ((m = BY_LINE_RE.exec(trimmed))) cur.by = oneLine(m[1]);
        }
        continue;
      }
      if (block.type !== 'tag') continue;
      if (block.name === 'Section' && block.props.id) {
        walk(block.children || [], open(block.props.title || block.props.id, block.props.id, block.props.needs));
        continue;
      }
      if ((block.name === 'ImplementationMap' || block.name === 'Checklist') && !cur) {
        warnings.push(`${block.name} is not under a component and was ignored; add {#id} to the heading above it`);
        continue;
      }
      if (block.name === 'ImplementationMap' && cur) {
        addFiles(cur, implementationFiles(block), warnings);
      } else if (block.name === 'Checklist' && cur) {
        for (const item of checklistItems(block)) {
          const m = HEADING_ID_RE.exec(item.label);
          const label = oneLine(item.label);
          if (!label) continue;
          cur.tasks.push({ id: uniqueId(m ? m[1] : '', `${cur.id}-${label.slice(0, 24)}`), label, checked: item.checked });
        }
        if (block.props.files) addFiles(cur, declaredFiles(block.props.files), warnings);
        if (block.props.by) cur.by = oneLine(block.props.by);
      } else if (block.name === 'Archify' && cur && !cur.url) {
        const rel = path.relative(workspaceRoot, path.resolve(dir, String(block.props.src || ''))).split(path.sep).join('/');
        if (/^production_artifacts\/\S+$/.test(rel)) cur.url = rel;
      } else if (block.children && block.children.length) {
        walk(block.children, cur);
      }
    }
  };
  walk(blocks, null);

  const ids = new Set(components.map((c) => c.id));
  for (const c of components) {
    const known = c.needs.filter((n) => ids.has(n) && n !== c.id);
    if (known.length !== c.needs.length) warnings.push(`${c.id}: dropped needs that are not components`);
    c.needs = known;
  }

  const title = oneLine(frontmatter.title) || oneLine((blocks.find((b) => b.type === 'heading' && b.level === 1) || {}).text) || 'Plan';
  const lines = [`# ${title}`, ''];
  for (const c of components) {
    lines.push(`## ${c.title} {#${c.id}}`);
    if (c.needs.length) lines.push(`needs: [${c.needs.join(', ')}]`);
    if (c.files.length) lines.push(`files: [${c.files.join(', ')}]`);
    if (c.by) lines.push(`by: ${c.by}`);
    if (c.url) lines.push(`url: ${c.url}`);
    for (const t of c.tasks) {
      // Live state survives regeneration: a mark already in the output file
      // ([~] in progress, [x] done, [!] stuck) wins over the source's checkbox.
      const kept = preserve.get(t.id);
      const state = kept || (t.checked ? 'x' : ' ');
      lines.push(`- [${state}] ${t.label} {#${t.id}}`);
    }
    lines.push('');
  }
  return {
    text: lines.join('\n'),
    components: components.length,
    tasks: components.reduce((n, c) => n + c.tasks.length, 0),
    warnings,
    graph: components
  };
}

function nearestRealpath(target) {
  let cur = target;
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return target;
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

function insideRoot(root, target) {
  const rel = path.relative(root, target);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Task marks worth carrying over a regeneration: anything but a fresh box.
// Checked case-insensitively; ids keep the plan convention's lowercase shape.
const EXISTING_MARK_RE = /^\s*[-*]\s+\[([^\]])\]\s+.*\{#([a-z0-9][a-z0-9-]*)\}\s*$/gim;

function preservedMarks(existing) {
  const marks = new Map();
  for (const m of existing.matchAll(EXISTING_MARK_RE)) {
    const mark = m[1].toLowerCase();
    if (mark === 'x' || mark === '~' || mark === '!') marks.set(m[2], mark);
  }
  return marks;
}

/**
 * @returns {{out: string, components: number, tasks: number, next_step: string, warnings?: string[]}}
 * @throws {TrailError} with a message fit for the user; callers map it to exit 2.
 */
function writeTrail(input, { out, force = false, workspaceRoot = process.cwd() } = {}) {
  if (!input) throw new TrailError('trail requires a plan folder or plan.mdx path');
  const target = path.resolve(input);
  let dir = target;
  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    if (path.basename(target) !== 'plan.mdx') throw new TrailError(`expected plan.mdx (got ${path.basename(target)})`);
    dir = path.dirname(target);
  } else if (!fs.existsSync(path.join(target, 'plan.mdx'))) {
    throw new TrailError(`no plan.mdx in ${input}`);
  }

  const root = nearestRealpath(path.resolve(workspaceRoot));
  const outPath = path.resolve(workspaceRoot, out || DEFAULT_OUT);
  const real = nearestRealpath(outPath);
  if (!insideRoot(root, real)) throw new TrailError(`output must be inside the workspace root (${workspaceRoot}): ${out}`);
  if (fs.existsSync(outPath) && !force) throw new TrailError(`${path.relative(workspaceRoot, outPath)} already exists; pass --force to overwrite`);
  if (fs.existsSync(outPath) && fs.statSync(outPath).isDirectory()) throw new TrailError(`output is a directory: ${out}`);

  // Regenerating never resets live state: marks ([~]/[x]/[!]) already ticked in
  // the output file ride over, matched by task id.
  const preserve = fs.existsSync(outPath) ? preservedMarks(fs.readFileSync(outPath, 'utf8')) : new Map();
  const result = derive(dir, { workspaceRoot, preserve });
  if (!result.components) throw new TrailError('no components found: tag headings with {#id} or use <Section id="..."> in the plan');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, result.text, { flag: force ? 'w' : 'wx' });
  const rel = path.relative(workspaceRoot, outPath).split(path.sep).join('/');
  return {
    out: rel,
    components: result.components,
    tasks: result.tasks,
    next_step: `aos-trail . --plan ${rel} --no-open`,
    ...(result.warnings.length ? { warnings: result.warnings } : {})
  };
}

module.exports = { derive, writeTrail, TrailError };
