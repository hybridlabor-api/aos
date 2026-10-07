// Codebase Memory MCP wiring: binary-presence probe, one-MCP-per-app pick, installer
// module registration, skill frontmatter and the doctor message contract. Pure node:test,
// no dependencies, no shell, no fs writes outside temporary directories.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const codebaseMemory = require('../lib/codebase-memory');
const installer = require('../installer.js');
const { applyPicks } = require('../lib/mcp-pick');

// fsImpl stub whose existsSync answers from a set of existing absolute paths.
const fsFrom = (existing) => ({ existsSync: (p) => existing.includes(String(p)) });

describe('cmbAppStatus (binary-presence probe)', () => {
    test('on PATH (darwin, no extra dirs)', () => {
        const status = codebaseMemory.cmbAppStatus({
            platform: 'darwin', env: { PATH: '/opt/bin:/usr/bin', HOME: '/home/t' },
            fsImpl: fsFrom(['/usr/bin/codebase-memory-mcp']),
        });
        assert.equal(status.found, true);
        assert.equal(status.path, '/usr/bin/codebase-memory-mcp');
        assert.equal(status.label, 'codebase-memory-mcp');
    });
    test('absent everywhere -> found false, path null', () => {
        const status = codebaseMemory.cmbAppStatus({ platform: 'darwin', env: { PATH: '', HOME: '/home/t' }, fsImpl: fsFrom([]) });
        assert.deepEqual(status, { found: false, path: null, label: 'codebase-memory-mcp' });
    });
    test('win32 .exe probe', () => {
        const status = codebaseMemory.cmbAppStatus({
            platform: 'win32', env: { PATH: 'C:\\opt\\bin', HOME: 'C:\\Users\\t' },
            fsImpl: fsFrom(['C:\\opt\\bin\\codebase-memory-mcp.exe']),
        });
        assert.equal(status.found, true);
    });
});

describe('one-MCP-per-app pick (mcp_picks.json group)', () => {
    const picks = JSON.parse(fs.readFileSync(path.join(ROOT, 'mcp_picks.json'), 'utf8')).groups;
    const group = picks.find((g) => g.group === 'codebase_memory');
    test('the group exists and is gated on the codebase-memory app', () => {
        assert.equal(group.candidates.length, 1, 'single candidate');
        assert.equal(group.candidates[0].name, 'codebase_memory_mcp');
        assert.deepEqual(group.candidates[0].requires, { app: 'codebase-memory' });
        assert.deepEqual(group.candidates[0].entry, { command: 'codebase-memory-mcp', args: [] });
    });
    test('binary present -> entry registered', () => {
        const detect = (app) => (app === 'codebase-memory' ? { path: '/usr/local/bin/codebase-memory-mcp' } : null);
        const r = applyPicks({}, picks, detect, {});
        assert.deepEqual(r.servers.codebase_memory_mcp, { command: 'codebase-memory-mcp', args: [] });
        assert.deepEqual(r.retired, []);
    });
    test('binary absent -> nothing registered', () => {
        const r = applyPicks({}, picks, () => null, {});
        assert.equal(r.servers.codebase_memory_mcp, undefined);
    });
});

describe('installer module registration', () => {
    test('installCodebaseMemory is exported', () => {
        assert.equal(typeof installer.installCodebaseMemory, 'function');
    });
    test('the optional module picker lists the codebase-memory id', () => {
        const src = fs.readFileSync(path.join(ROOT, 'installer.js'), 'utf8');
        assert.ok(src.includes("{ id: 'codebase-memory', name: 'Codebase Memory MCP"), 'module picker entry missing');
        assert.ok(src.includes("subId === 'codebase-memory'"), 'quick-update loop entry missing');
        assert.ok(src.includes("codebaseMemory.cmbAppStatus().found && !installedModules.includes('codebase-memory')"), 'installed-state detection missing');
    });
    test('the picker stays optional: --modules=all-external selection excludes nothing here, binary gate applies', () => {
        // Contract reminder: the module never downloads anything at install time
        // (no downloadOrUpdateModule call for codebase-memory).
        const src = fs.readFileSync(path.join(ROOT, 'installer.js'), 'utf8');
        const fnStart = src.indexOf('function installCodebaseMemory');
        const fnBody = src.slice(fnStart, src.indexOf('}', src.indexOf('harness MCP sync', fnStart)));
        assert.ok(!fnBody.includes('downloadOrUpdateModule'), 'must not download at install time');
    });
});

describe('doctor message contract', () => {
    test('app missing message names the binary', () => {
        const msg = codebaseMemory.cmbMissingMessage({ status: { found: false, path: null, label: 'codebase-memory-mcp' } });
        assert.match(msg, /^app missing: codebase-memory-mcp/);
    });
    test('doctor ships the check (source contains the codebase-memory block)', () => {
        const src = fs.readFileSync(path.join(ROOT, 'bin', 'aos-doctor.mjs'), 'utf8');
        assert.ok(src.includes("req('../lib/codebase-memory.js')"));
        assert.ok(src.includes('codebaseMemory.cmbMissingMessage'));
    });
});

describe('skill: skills/codebase-memory/SKILL.md', () => {
    const file = path.join(ROOT, 'skills', 'codebase-memory', 'SKILL.md');
    const fm = {};
    let text = '';
    test('frontmatter: name, description, category, no model names', () => {
        assert.equal(fs.existsSync(file), true, 'SKILL.md missing');
        text = fs.readFileSync(file, 'utf8');
        assert.match(text, /^---\n[\s\S]+?\n---/);
        const m = text.match(/^---\n([\s\S]+?)\n---/);
        for (const line of m[1].split('\n')) {
            const kv = line.match(/^(name|category): (.+)$/);
            if (kv) fm[kv[1]] = kv[2].trim();
        }
        assert.equal(fm.name, 'codebase-memory');
        assert.equal(fm.category, 'bdb-core');
        assert.match(text, /context minimisation/i);
        const desc = text.match(/description: >-\n([\s\S]+?)\ncategory/)[1];
        assert.ok(desc.length > 20, 'description too short');
        assert.ok(/code research/i.test(desc), 'description must state the code-research trigger');
    });
    test('synergy hints to synapse and memB; no model names', () => {
        assert.match(text, /\bSynapse\b/);
        assert.match(text, /\bmemB\b/);
        assert.ok(!/clau?dson|gpt|opus|sonnet|haiku|gemini/i.test(text));
    });
});

describe('manifests: skills.sh.json grouping', () => {
    test('codebase-memory is grouped in Core & Pipeline', () => {
        const grouped = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills.sh.json'), 'utf8'));
        const hit = grouped.groupings.some((g) => Array.isArray(g.skills) && g.skills.includes('codebase-memory'));
        assert.equal(hit, true, 'skills.sh.json: codebase-memory not grouped');
    });
});
