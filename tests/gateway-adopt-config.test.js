// Adopted stdio servers as extra gateway upstreams (adopt.json contract, work package B).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfg = require('../lib/gateway/config.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-adopt-cfg-'));
const home = '/home/u';
const launcher = '/home/u/.agents/bin/aos-mcp-env.mjs';
const shipped = {
    github: { command: 'npx', args: ['-y', 'pkg@1.0.0'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_x' } },
    deja: { command: 'deja', args: ['mcp'] },
};
const pathEnv = '/usr/bin:/bin';

describe('adopted upstreams', () => {
    test('absent adopted.json leaves upstreams unchanged', () => {
        const h = tmp();
        const without = cfg.buildUpstreams({ shipped, home: h, launcher, pathEnv, adopted: {} });
        assert.deepEqual(Object.keys(without).sort(), ['github']);
        const out = cfg.buildUpstreams({ shipped, home: h, launcher, pathEnv });
        assert.deepEqual(Object.keys(out).sort(), ['github']);
        assert.deepEqual(out, without);
    });

    test('a valid adopted server appears as stdio with its env and cwd', () => {
        const h = tmp();
        const dir = cfg.gatewayDir(h);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'adopted.json'), JSON.stringify({
            version: 1,
            servers: { mine: { command: 'node', args: ['mine.js'], env: { FOO: 'bar' }, cwd: '/work', from: ['/x'], at: 1 } },
        }));
        const adopted = cfg.readAdopted(h);
        assert.deepEqual(adopted.mine, { command: 'node', args: ['mine.js'], env: { FOO: 'bar' }, cwd: '/work' });
        const out = cfg.buildUpstreams({ shipped, home: h, launcher, pathEnv });
        assert.deepEqual(out.mine, {
            type: 'stdio',
            command: 'node',
            args: ['mine.js'],
            cwd: '/work',
            env: { FOO: 'bar', PATH: pathEnv, HOME: h },
            inheritParentEnv: false,
            tags: ['aos', 'mine'],
        });
        assert.deepEqual(Object.keys(out).sort(), ['github', 'mine']);
    });

    test('an adopted argument is used directly instead of reading the file', () => {
        const out = cfg.buildUpstreams({ shipped, home, launcher, pathEnv, adopted: { mine: { command: 'n', args: [] } } });
        assert.deepEqual(out.mine.command, 'n');
    });

    test('invalid entries are dropped', () => {
        const h = tmp();
        const dir = cfg.gatewayDir(h);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'adopted.json'), JSON.stringify({
            version: 1,
            servers: {
                good: { command: 'node', args: [], env: {} },
                'bad name': { command: 'node', args: [] },
                [`${'a'.repeat(27)}`]: { command: 'node', args: [] },
                github: { command: 'spoof', args: [] },
                deja: { command: 'spoof', args: [] },
                nocommand: { args: [] },
                shortargs: { command: 'node', args: ['ok', 5] },
                badenv: { command: 'node', args: [], env: { K: 5 } },
                badcwd: { command: 'node', args: [], cwd: 7 },
                nonobject: 'nope',
            },
        }));
        const adopted = cfg.readAdopted(h);
        assert.deepEqual(Object.keys(adopted), ['good']);
    });

    test('secret-looking env values are stripped at build time (defence in depth)', () => {
        const h = tmp();
        const dir = cfg.gatewayDir(h);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'adopted.json'), JSON.stringify({
            version: 1,
            servers: { mine: { command: 'node', args: [], env: { SOME_API_KEY: 'sk-value' } } },
        }));
        const out = cfg.buildUpstreams({ shipped, home: h, launcher, pathEnv });
        assert.equal(out.mine.env.SOME_API_KEY, undefined);
    });

    test('invalid JSON file yields an empty object, never thrown', () => {
        const h = tmp();
        const dir = cfg.gatewayDir(h);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'adopted.json'), '{broken');
        assert.deepEqual(cfg.readAdopted(h), {});
        assert.deepEqual(Object.keys(cfg.buildUpstreams({ shipped, home: h, launcher, pathEnv })), ['github']);
    });
});
