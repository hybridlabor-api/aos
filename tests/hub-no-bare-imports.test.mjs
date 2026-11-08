import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, cpSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const hubFiles = walk(join(root, 'lib', 'hub')).filter((f) => /\.mjs$/.test(f));
const BARE = /(?:^|\n)\s*(?:import\s[^'"\n]*?from\s*|import\s*)['"]([^./'"][^'"]*)['"]|\bimport\(\s*['"]([^./'"][^'"]*)['"]/g;
const ALLOWED = new Set();

test('lib/hub imports no bare package outside the allowlist', () => {
    const bad = [];
    for (const f of hubFiles) {
        for (const m of readFileSync(f, 'utf8').matchAll(BARE)) {
            const spec = m[1] || m[2];
            if (!spec.startsWith('node:') && !ALLOWED.has(spec)) bad.push(`${f.slice(root.length + 1)}: ${spec}`);
        }
    }
    assert.deepEqual(bad, []);
});

test('every lib/hub module loads from a copy without node_modules', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hub-nomods-'));
    try {
        cpSync(join(root, 'lib'), join(tmp, 'lib'), { recursive: true });
        cpSync(join(root, 'package.json'), join(tmp, 'package.json'));
        for (const f of hubFiles) {
            const rel = f.slice(root.length + 1);
            const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify('file://' + join(tmp, rel).replace(/\\/g, '/'))})`], { encoding: 'utf8', cwd: tmp });
            assert.ok(!/Cannot find package/.test(r.stderr), `${rel}: ${r.stderr.split('\n')[0]}`);
        }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});
