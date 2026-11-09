// #260: Windows `aos-gateway stop` ends only the gateway recorded in THIS directory's pid files.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const load = () => import(pathToFileURL(path.join(ROOT, 'bin', 'aos-gateway.mjs')).href);

function setup(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gwstop-'));
    for (const [n, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), String(v));
    return dir;
}
const SERVE = (p) => `"C:\\Program Files\\nodejs\\node.exe" "C:\\aos\\bin\\${p}" "serve"`;

test('matching pid is stopped with its tree, the 1mcp child too, pid files removed', async () => {
    const { stopWinGateway } = await load();
    const dir = setup({ 'gateway.pid': 100, 'upstream.pid': 101 });
    const cmds = { 100: SERVE('aos-gateway.mjs'), 101: `node "${path.join(dir, 'node_modules', '@1mcp', 'agent', 'build', 'index.js')}" serve --config-dir "${dir}"`.replace(/\//g, '\\'), 200: SERVE('aos-gateway.mjs') };
    const killed = [];
    const r = stopWinGateway(dir, { cmdLine: (p) => cmds[p] || '', kill: (p) => killed.push(p) });
    assert.deepEqual(killed, [100, 101]);
    assert.deepEqual(r, [100, 101]);
    assert.equal(fs.existsSync(path.join(dir, 'gateway.pid')), false);
    assert.equal(fs.existsSync(path.join(dir, 'upstream.pid')), false);
});

test('a decoy with aos-gateway.mjs serve and another pid is untouched', async () => {
    const { stopWinGateway } = await load();
    const dir = setup({ 'gateway.pid': 100 });
    const killed = [];
    stopWinGateway(dir, { cmdLine: (p) => (p === 100 || p === 999 ? SERVE('aos-gateway.mjs') : ''), kill: (p) => killed.push(p) });
    assert.deepEqual(killed, [100]);
});

test('stale pid (other command line or gone) is ignored and the file removed', async () => {
    const { stopWinGateway } = await load();
    const dir = setup({ 'gateway.pid': 100, 'upstream.pid': 101 });
    const killed = [];
    const r = stopWinGateway(dir, { cmdLine: (p) => (p === 100 ? 'C:\\Windows\\notepad.exe' : ''), kill: (p) => killed.push(p) });
    assert.deepEqual(killed, []);
    assert.deepEqual(r, []);
    assert.equal(fs.existsSync(path.join(dir, 'gateway.pid')), false);
    assert.equal(fs.existsSync(path.join(dir, 'upstream.pid')), false);
});

test('no pid files: nothing is killed', async () => {
    const { stopWinGateway } = await load();
    const killed = [];
    assert.deepEqual(stopWinGateway(setup({}), { cmdLine: () => SERVE('aos-gateway.mjs'), kill: (p) => killed.push(p) }), []);
    assert.deepEqual(killed, []);
});
