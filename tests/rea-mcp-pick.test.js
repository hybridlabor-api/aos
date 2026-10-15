// REA MCP pick: opt-in, gated on AOS_REA_MCP=on, direct (never gateway), dual-use note.
// Pure node:test, no network, no shell.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const secrets = require('../lib/mcp-secrets');
const cfg = require('../lib/gateway/config');

const picksJson = JSON.parse(require('fs').readFileSync(path.join(ROOT, 'mcp_picks.json'), 'utf8'));
const entryOf = (name) => picksJson.groups.flatMap((g) => g.candidates).find((c) => c.name === name)?.entry;
const groupOf = (name) => picksJson.groups.find((g) => g.candidates.some((c) => c.name === name));

describe('rea_mcp pick', () => {
    test('pick is absent unless AOS_REA_MCP=on', () => {
        const s = secrets.shippedServers(ROOT, { env: {} });
        assert.ok(!s.rea_mcp, 'default env');
        const r = secrets.shippedPicks(ROOT, { env: {} });
        assert.ok(!r.servers.rea_mcp, 'picks default');
    });

    test('AOS_REA_MCP=on registers the pinned npx entry', () => {
        const s = secrets.shippedServers(ROOT, { env: { AOS_REA_MCP: 'on' } });
        const e = s.rea_mcp;
        assert.ok(e, 'rea_mcp registered');
        assert.equal(e.command, 'npx');
        assert.deepEqual(e.args, ['-y', 'rea-agents@6.5.0', '--mcp']);
    });

    test('wrong opt-in value stays off (exact match)', () => {
        assert.ok(!secrets.shippedServers(ROOT, { env: { AOS_REA_MCP: '1' } }).rea_mcp);
        assert.ok(!secrets.shippedServers(ROOT, { env: { AOS_REA_MCP: 'true' } }).rea_mcp);
    });

    test('gateway routing: rea_mcp is direct, not gateway', () => {
        assert.ok(cfg.DIRECT_SERVERS.includes('rea_mcp'));
        assert.ok(!cfg.GATEWAY_SERVERS.includes('rea_mcp'));
    });

    test('entry carries no secret values and is wrapped without extra vars', () => {
        const e = entryOf('rea_mcp');
        assert.ok(e);
        assert.equal(e.env, undefined);
        assert.ok(!JSON.stringify(e).match(/sk-|ghp_|AIza/));
        const wrapped = secrets.wrapServer('rea_mcp', e, '/agents/bin/aos-mcp-env.mjs');
        const u = secrets.unwrap(wrapped);
        assert.deepEqual(u.vars, []);
    });

    test('group carries a dual-use note and is never a default selection', () => {
        const g = groupOf('rea_mcp');
        assert.ok(g);
        assert.ok(g.note && g.note.includes('dual-use'), g.note);
        assert.ok(g.note && g.note.includes('opt-in'), g.note);
        assert.ok(g.note && g.note.includes('never a default'), g.note);
    });
});

describe('rea_mcp secrets hint', () => {
    test('doctor hint names the opt-in flag when off', () => {
        assert.ok(secrets.reaDoctorHint({}).includes('AOS_REA_MCP=on'));
    });

    test('doctor hint is null when the opt-in flag is on', () => {
        assert.equal(secrets.reaDoctorHint({ AOS_REA_MCP: 'on' }), null);
    });
});
