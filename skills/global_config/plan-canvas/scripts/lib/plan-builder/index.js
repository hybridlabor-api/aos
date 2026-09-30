'use strict';

/**
 * BDB Plan Builder — turn an Agent-Native-style plan folder into ONE
 * self-contained HTML file in the BDB look, which `aos-plan-canvas` then opens
 * through the normal `.html` artifact path (annotation, chat and verdict all
 * already work for HTML).
 *
 * No dependencies, no network at build time. Plan content is treated as
 * untrusted input: everything is escaped, and raw HTML only ever reaches a
 * sandboxed iframe without `allow-scripts`.
 *
 *   renderPlanFolder('./plans/my-plan')  -> { html, warnings, outFile }
 *   renderPlanSource({ plan, canvas })    -> { html, warnings }
 *   parseMdx(text)                       -> blocks
 */

const fs = require('fs');
const path = require('path');

const { parseMdx } = require('./mdx');
const { renderBlocks, page } = require('./render');
const { slugify } = require('../plan-canvas/markdown');

const PLAN_FILE = 'plan.mdx';
const OUTPUT_FILE = 'plan.builder.html';
const OPTIONAL_SOURCES = [
  { key: 'canvas', file: 'canvas.mdx', title: 'Canvas' },
  { key: 'prototype', file: 'prototype.mdx', title: 'Prototype' }
];

function readIfPresent(dir, file, warnings) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return null;
  try {
    return fs.readFileSync(full, 'utf8');
  } catch (error) {
    warnings.push(`could not read ${file}: ${error.message}`);
    return null;
  }
}

/**
 * Render one or more MDX sources into a single HTML document.
 *
 * @param {{plan?: string, canvas?: string, prototype?: string, state?: object, title?: string}} source
 * @returns {{html: string, warnings: string[]}}
 */
function renderPlanSource(source = {}) {
  const warnings = [];
  const ctx = { warnings, headings: [], ids: new Map(), hasMermaid: false };
  const sections = [];

  const render = (mdx, heading) => {
    const blocks = parseMdx(text(mdx));
    for (const warning of blocks.warnings || []) warnings.push(warning);
    if (heading) {
      const id = uniqueHeading(heading, ctx);
      ctx.headings.push({ id, text: heading, level: 2 });
      sections.push(`<h2 class="sec" id="${id}">${heading}</h2>`);
    }
    sections.push(renderBlocks(blocks, ctx));
    return blocks.frontmatter || {};
  };

  const frontmatter = render(source.plan, null);
  for (const extra of OPTIONAL_SOURCES) {
    const mdx = source[extra.key];
    if (!text(mdx)) continue;
    render(mdx, extra.title);
  }

  const state = source.state && typeof source.state === 'object' ? source.state : {};
  const title = source.title || frontmatter.title || state.title || 'Plan';
  const status = text(frontmatter.status || state.status || state.kind);
  const meta = [
    state.kind ? `kind: ${state.kind}` : '',
    state.localOnly ? 'local-only' : '',
    `${warnings.length} warning(s)`
  ].filter(Boolean).join(' · ');

  const body = sections.filter(Boolean).join('\n');
  const html = page({
    title: text(title),
    status,
    meta,
    headings: ctx.headings,
    body,
    warnings,
    hasMermaid: ctx.hasMermaid
  });
  return { html, warnings };
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function uniqueHeading(raw, ctx) {
  const base = slugify(raw) || 'section';
  const count = ctx.ids.get(base) || 0;
  ctx.ids.set(base, count + 1);
  return count ? `${base}-${count}` : base;
}

/**
 * Build the HTML for a plan folder (or a single plan.mdx path) and write it
 * next to the plan as `plan.builder.html`.
 *
 * A folder without `plan.mdx` is an error, reported — never thrown — so the
 * CLI can turn it into exit code 2 with a clear message.
 *
 * @param {string} dirOrFile
 * @returns {{html?: string, warnings: string[], outFile?: string, error?: string}}
 */
function renderPlanFolder(dirOrFile) {
  const warnings = [];
  const target = path.resolve(dirOrFile);

  let dir = target;
  let planPath = path.join(target, PLAN_FILE);
  let stat = null;
  try {
    stat = fs.statSync(target);
  } catch {
    stat = null;
  }

  if (stat && stat.isFile()) {
    dir = path.dirname(target);
    planPath = target;
    if (path.basename(target) !== PLAN_FILE) {
      return { error: `expected ${PLAN_FILE} (got ${path.basename(target)})`, warnings };
    }
  } else if (!stat) {
    return { error: `plan path not found: ${dirOrFile}`, warnings };
  } else if (!stat.isDirectory()) {
    return { error: `not a plan folder or file: ${dirOrFile}`, warnings };
  }

  if (!fs.existsSync(planPath)) {
    return { error: `no ${PLAN_FILE} in ${dir}`, warnings };
  }

  let planText;
  try {
    planText = fs.readFileSync(planPath, 'utf8');
  } catch (error) {
    return { error: `could not read ${planPath}: ${error.message}`, warnings };
  }

  const source = { plan: planText };
  for (const extra of OPTIONAL_SOURCES) {
    const mdx = readIfPresent(dir, extra.file, warnings);
    if (mdx) source[extra.key] = mdx;
  }
  const statePath = path.join(dir, '.plan-state.json');
  if (fs.existsSync(statePath)) {
    try {
      source.state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (error) {
      warnings.push(`could not parse .plan-state.json: ${error.message}`);
    }
  }

  const result = renderPlanSource(source);
  warnings.push(...result.warnings);

  const outFile = path.join(dir, OUTPUT_FILE);
  try {
    fs.writeFileSync(outFile, result.html);
  } catch (error) {
    return { html: result.html, warnings, error: `could not write ${outFile}: ${error.message}` };
  }

  return { html: result.html, warnings, outFile };
}

module.exports = { renderPlanFolder, renderPlanSource, parseMdx, OUTPUT_FILE, PLAN_FILE };