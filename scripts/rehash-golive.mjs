#!/usr/bin/env node
// Rewrites skills/global_config/golive/release.json after an AOS edit to the vendored skill (the frontmatter
// `category`). golive's CLI refuses to start unless every file hash and the bundleDigest match
// (verifyReleaseBundle in scripts/golive.mjs); the digest formula is copied from there. --check only compares.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'global_config', 'golive');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const walk = (d) => readdirSync(join(root, d)).sort().flatMap((e) => {
    const rel = d ? `${d}/${e}` : e;
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
});

export function expectedRelease() {
    const cur = JSON.parse(readFileSync(join(root, 'release.json'), 'utf8'));
    const files = Object.fromEntries(walk('').filter((f) => f !== 'release.json').map((f) => [f, sha(readFileSync(join(root, f)))]));
    const { bundleDigest: _old, ...body } = { ...cur, files };
    return { ...body, bundleDigest: sha(JSON.stringify(sorted(body))) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const want = `${JSON.stringify(expectedRelease(), null, 2)}\n`;
    const have = readFileSync(join(root, 'release.json'), 'utf8');
    if (process.argv.includes('--check')) process.exit(have === want ? 0 : 1);
    writeFileSync(join(root, 'release.json'), want);
}
