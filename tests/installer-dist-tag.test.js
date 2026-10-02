const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const { newestDistTag } = require('../installer.js');
const view = (tags) => () => JSON.stringify(tags);

test('newestDistTag returns the newest tag that is ahead of the local version', () => {
    assert.deepStrictEqual(newestDistTag('p', '1.0.0', view({ latest: '1.2.0', next: '1.1.0' })), { tag: 'latest', version: '1.2.0' });
    assert.deepStrictEqual(newestDistTag('p', '1.0.0', view({ latest: '1.2.0', beta: '1.3.0-beta.1' })), { tag: 'beta', version: '1.3.0-beta.1' });
});

test('newestDistTag is null when nothing is ahead, npm is unreachable or the answer is garbage', () => {
    assert.strictEqual(newestDistTag('p', '2.0.0', view({ latest: '1.2.0' })), null);
    assert.strictEqual(newestDistTag('p', '1.0.0', () => { throw new Error('offline'); }), null);
    assert.strictEqual(newestDistTag('p', '1.0.0', () => 'not json'), null);
    assert.strictEqual(newestDistTag('p', '1.0.0', view({ latest: 5 })), null);
});

test('verifyEcosystemInstallation reaches the AO line (installed ao with a trusted version) without throwing', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-verify-'));
    try {
        const START = Buffer.from('3077af0c9274080241e1c107e6d618e6', 'hex');
        const END = Buffer.from('f932433186182072008242104116d8f2', 'hex');
        const info = '\tbuild\tvcs.revision=abc123def\n\tbuild\tvcs.time=2026-01-01T00:00:00Z\n\tbuild\tvcs.modified=false\n';
        fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
        fs.writeFileSync(path.join(home, '.local', 'bin', 'ao'), Buffer.concat([Buffer.from('fake-ao'), START, Buffer.from(info), END]));
        fs.mkdirSync(path.join(home, '.agents'), { recursive: true });
        fs.writeFileSync(path.join(home, '.agents', '.bdb-manifest.json'), JSON.stringify({ ao: { version: '1.4.0', revision: 'abc123def' } }));
        const r = spawnSync(process.execPath, ['-e', "require('./installer.js').verifyEcosystemInstallation()"], {
            cwd: root,
            env: { ...process.env, HOME: home, USERPROFILE: home, PATH: '/usr/bin:/bin' },
            encoding: 'utf8',
            timeout: 60000,
        });
        assert.strictEqual(r.status, 0, r.stderr);
        assert.doesNotMatch(r.stderr, /ReferenceError/);
        assert.match(r.stdout, /BDB Agent Orchestrator|AO Agent Orchestrator/i);
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
});
