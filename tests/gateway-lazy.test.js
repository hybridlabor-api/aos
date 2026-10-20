// Lazy loading flag on the 1mcp serve args (default on, gateway.json opt-out, bad file) and recovery keys on generated upstreams.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const cfg = require('../lib/gateway/config.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gwlazy-'));

async function serveArgs(overrideText) {
    const { startServe } = await import(pathToFileURL(path.join(ROOT, 'bin', 'aos-gateway.mjs')).href);
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'token'), 'd'.repeat(64), { mode: 0o600 });
    if (overrideText !== undefined) fs.writeFileSync(path.join(dir, 'gateway.json'), overrideText);
    let args;
    const spawnFn = (cmd, a) => {
        args = a;
        return { pid: undefined, exitCode: null, signalCode: null, on() {}, once() {}, kill() {} };
    };
    const h = await startServe({ dir, port: 0, upstreamPort: 59000 + Math.floor(Math.random() * 500), spawnFn, entry: '/x/1mcp.js', log: () => {} });
    await h.stop();
    return args;
}

describe('gateway lazy loading', () => {
    test('on by default, with full fallback', async () => {
        const a = await serveArgs();
        assert.ok(a.includes('--enable-lazy-loading'));
        assert.equal(a[a.indexOf('--lazy-fallback-on-error') + 1], 'full');
    });
    test('gateway.json lazyLoading=false turns it off', async () => {
        const a = await serveArgs('{"lazyLoading": false}');
        assert.ok(!a.includes('--enable-lazy-loading'));
        assert.ok(!a.includes('--lazy-fallback-on-error'));
    });
    test('unparseable gateway.json keeps the default', async () => {
        assert.ok((await serveArgs('{not json')).includes('--enable-lazy-loading'));
        assert.ok((await serveArgs('{"lazyLoading": "no"}')).includes('--enable-lazy-loading'));
    });
});

describe('gateway upstream recovery keys', () => {
    test('every generated shipped stdio upstream restarts on exit, 3 times, 2 s apart', () => {
        const shipped = { github: { command: 'npx', args: ['-y', 'pkg@1.0.0'] } };
        const out = cfg.buildUpstreams({ shipped, home: '/h', launcher: '/l.js', pathEnv: '/bin', adopted: { mine: { command: 'node', args: [] } } });
        assert.deepEqual(Object.keys(out).sort(), ['github', 'mine']);
        assert.equal(out.mine.restartOnExit, undefined);
        for (const u of [out.github]) {
            assert.equal(u.type, 'stdio');
            assert.equal(u.restartOnExit, true);
            assert.equal(u.maxRestarts, 3);
            assert.equal(u.restartDelay, 2000);
        }
    });
});
