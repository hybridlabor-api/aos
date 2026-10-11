const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const installer = require('../installer.js');

describe('runModuleInstalls', () => {
    test('records only modules whose installer reports success', async () => {
        const installed = ['old'];
        const mods = [
            { id: 'ok', name: 'Ok', fn: async () => true },
            { id: 'implicit', name: 'Implicit', fn: async () => {} },
            { id: 'soft-fail', name: 'Soft', fn: async () => false },
            { id: 'throws', name: 'Throws', fn: async () => { throw new Error('boom'); } },
        ];
        const res = await installer.runModuleInstalls(mods, ['ok', 'implicit', 'soft-fail', 'throws'], installed);
        assert.deepEqual(res.installed, ['ok', 'implicit']);
        assert.deepEqual(installed, ['old', 'ok', 'implicit']);
        assert.deepEqual(res.failed.map((f) => f.id), ['soft-fail', 'throws']);
        assert.match(res.failed[1].reason, /boom/);
    });
});

describe('describeExecError', () => {
    test('includes bounded, redacted child output', () => {
        let err;
        try {
            execFileSync(process.execPath, ['-e',
                'console.error("fatal: GEMINI_API_KEY=abc123xyz token: s3cr3tvalue " + "x".repeat(5000)); process.exit(3)'],
                { stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (e) { err = e; }
        const msg = installer.describeExecError(err);
        assert.match(msg, /fatal:/);
        assert.ok(!msg.includes('abc123xyz'));
        assert.ok(!msg.includes('s3cr3tvalue'));
        assert.ok(msg.length < 2600);
    });
});

describe('mirrorMcpServersTo', () => {
    test('keeps a user entry that shares a name with an AOS server but runs another command', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-p3-'));
        const file = path.join(tmp, 'mcp_config.json');
        fs.writeFileSync(file, JSON.stringify({ mcpServers: { memb_mcp: { command: 'x', env: { KEEP: 'p' } } } }));
        installer.mirrorMcpServersTo([file], JSON.stringify({ mcpServers: { memb_mcp: { command: 'y', env: { GEMINI_API_KEY: '' } } } }));
        const out = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.equal(out.mcpServers.memb_mcp.command, 'x');
        assert.deepEqual(out.mcpServers.memb_mcp.env, { KEEP: 'p' });
    });
});

describe('atomic manifest writes', () => {
    test('a failed rename leaves the previous manifest intact and no temp file', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-p3-'));
        const file = path.join(tmp, 'manifest.json');
        fs.writeFileSync(file, '{"old":true}');
        const realRename = fs.renameSync;
        fs.renameSync = () => { throw new Error('simulated crash before rename'); };
        try {
            installer.saveInstallManifest({ fresh: true }, file);
        } finally {
            fs.renameSync = realRename;
        }
        assert.equal(fs.readFileSync(file, 'utf8'), '{"old":true}');
        assert.deepEqual(fs.readdirSync(tmp), ['manifest.json']);
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    test('a successful write replaces the file', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-p3-'));
        const file = path.join(tmp, 'manifest.json');
        installer.saveInstallManifest({ fresh: true }, file);
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { fresh: true });
        assert.deepEqual(fs.readdirSync(tmp), ['manifest.json']);
        fs.rmSync(tmp, { recursive: true, force: true });
    });
});
