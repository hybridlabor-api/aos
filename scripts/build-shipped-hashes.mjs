#!/usr/bin/env node
// Build lib/shipped-hashes.json: the SHA-256 of every file under the
// installer's payload dirs, across all shipped releases (git tags v*).
// A file on disk whose hash appears here is AOS-owned and is overwritten
// by the installer without a .new. Run at pack time (package.json prepack).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAYLOAD_DIRS = [
    'skills/',
    'bin/',
    '.claude/hooks/',
    '.claude/agents/',
    '.claude/workflows/',
    'agy-hooks/',
    'agy-commands/',
    'agents/',
    '.agents/',
    '.opencode/',
    '.codex/',
    'lib/',
    // initFullSession (installer.js) tracks these roots too.
    'mcps/',
    '.cursor/',
    '.github/',
    '.codex-plugin/',
    'RULES.md',
    'AGENTS.md',
    'CLAUDE.md',
    'CODEX.md',
];

const tags = execFileSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean).sort();
// A clone without tags (shallow CI checkout) would ship an empty list: the
// installer then just falls back to .new for old releases. Refuse that only
// for a real publish; a test or local `npm pack` gets a warning.
if (!tags.length) {
    if (process.env.npm_command === 'publish') {
        console.error('shipped-hashes: no v* tags in this clone; fetch tags before publishing');
        process.exit(1);
    }
    console.warn('shipped-hashes: no v* tags in this clone; writing an empty list');
}

const blobIds = new Set();
for (const tag of tags) {
    const out = execFileSync('git', ['ls-tree', '-r', tag], { cwd: root, encoding: 'utf8' });
    for (const line of out.split('\n')) {
        const m = /^\d+ blob (\S+)\t(.*)$/.exec(line);
        if (!m) continue;
        if (!PAYLOAD_DIRS.some((d) => m[2].startsWith(d))) continue;
        blobIds.add(m[1]);
    }
}

const hashes = new Set();
for (const id of blobIds) {
    const content = execFileSync('git', ['cat-file', 'blob', id], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    hashes.add(crypto.createHash('sha256').update(content).digest('hex'));
}

// An empty file matches anything a user truncated; it proves no ownership.
hashes.delete(crypto.createHash('sha256').update('').digest('hex'));
const sorted = [...hashes].sort();
fs.writeFileSync(path.join(root, 'lib', 'shipped-hashes.json'), JSON.stringify(sorted) + '\n');
console.log(`shipped-hashes: ${sorted.length} hashes from ${tags.length} tags`);
