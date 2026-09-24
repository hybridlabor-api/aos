/**
 * @typedef {import('js-yaml').YamlMap} YamlMap
 *
 * NOTE: This module depends on the npm package `js-yaml`.
 * Add it to package.json: `npm i js-yaml`
 * The package.json currently has no YAML dependency.
 */
import { load as parseYaml } from 'js-yaml';
import { readFile } from 'node:fs/promises';

/**
 * Load and merge the rulebook YAML files.
 *
 * @param {{ defaultsPath: string; overridePath?: string }} opts
 * @param {string} opts.defaultsPath - Path to the default rulebook YAML (e.g. packages/core/rulebook.default.yaml)
 * @param {string} [opts.overridePath] - Path to the user override rulebook YAML (e.g. ~/.config/mcsc/rulebook.yaml)
 * @returns {import('./rulebook.types.js').Rule[]} Merged rule list, with overrides applied by id,
 *   disabled ids removed, and unknown ids appended.
 */
export async function loadRulebook({ defaultsPath, overridePath }) {
  const defaultsContent = await readFile(defaultsPath, 'utf8');
  const defaultsYaml = parseYaml(defaultsContent);

  // Build a Map keyed by rule id for O(1) lookups and whole-rule replace
  const merged = new Map();
  for (const rule of defaultsYaml.rules || []) {
    merged.set(rule.id, rule);
  }

  // Apply override layer
  if (overridePath) {
    try {
      const overrideContent = await readFile(overridePath, 'utf8');
      const overrideYaml = parseYaml(overrideContent);

      // Per architecture.md §2: a top-level `disabled: [id]` list removes
      // shipped rules — this is NOT a per-rule field.
      for (const id of overrideYaml.disabled || []) {
        merged.delete(id);
      }

      // Whole-rule replace by id (Map#set both replaces a known id and
      // appends an unknown one — no deep-merging of candidate arrays).
      for (const rule of overrideYaml.rules || []) {
        merged.set(rule.id, rule);
      }
    } catch (_) {
      // If override file doesn't exist or can't be parsed, keep defaults as-is
    }
  }

  return [...merged.values()];
}