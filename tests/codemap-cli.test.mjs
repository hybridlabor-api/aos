import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

test('aos-map cli test', async (t) => {
    let tempHome;
    const bin = path.resolve(process.cwd(), 'bin', 'aos-map.mjs');

    t.beforeEach(() => {
        tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-map-test-'));
        const mapDir = path.join(tempHome, '.aos', 'map');
        fs.mkdirSync(mapDir, { recursive: true });
        fs.writeFileSync(path.join(mapDir, 'architecture.json'), JSON.stringify({
            parts: [
                { id: 'a', name: 'Node A', summary: 'Summary A', globs: ['a.js'] },
                { id: 'b', name: 'Node B', summary: 'Summary B', globs: ['b.js'] },
                { id: 'c', name: 'Node C', summary: 'Summary C', globs: ['c.js'] }
            ],
            connections: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]
        }));
    });

    t.afterEach(() => {
        if (tempHome) {
            fs.rmSync(tempHome, { recursive: true, force: true });
        }
    });

    await t.test('overview', () => {
        const out = execFileSync(process.execPath, [bin, 'overview'], { cwd: tempHome }).toString();
        assert.match(out, /3 parts/);
        assert.match(out, /a - Node A - Summary A/);
    });

    await t.test('find', () => {
        const outId = execFileSync(process.execPath, [bin, 'find', 'a'], { cwd: tempHome }).toString();
        assert.match(outId, /a - Node A/);

        const outName = execFileSync(process.execPath, [bin, 'find', 'node b'], { cwd: tempHome }).toString();
        assert.match(outName, /b - Node B/);

        const outFile = execFileSync(process.execPath, [bin, 'find', 'c.js'], { cwd: tempHome }).toString();
        assert.match(outFile, /c - Node C/);

        try {
            execFileSync(process.execPath, [bin, 'find', 'missing'], { cwd: tempHome });
            assert.fail('should exit 1 on missing find');
        } catch (e) {
            assert.strictEqual(e.status, 1);
        }
    });

    await t.test('show', () => {
        const outSpecific = execFileSync(process.execPath, [bin, 'show', 'a'], { cwd: tempHome }).toString();
        assert.match(outSpecific, /a - Node A/);

        const outSpecificFile = execFileSync(process.execPath, [bin, 'show', 'c.js'], { cwd: tempHome }).toString();
        assert.match(outSpecificFile, /c - Node C/);

        try {
            execFileSync(process.execPath, [bin, 'show', 'missing'], { cwd: tempHome });
            assert.fail('should exit 1 on missing show');
        } catch (e) {
            assert.strictEqual(e.status, 1);
        }
    });

    await t.test('path', () => {
        const out = execFileSync(process.execPath, [bin, 'path', 'a', 'c'], { cwd: tempHome }).toString();
        assert.match(out, /Path from a to c: a -> b -> c/);

        try {
            execFileSync(process.execPath, [bin, 'path', 'a', 'missing'], { cwd: tempHome });
            assert.fail('should exit 1 on missing path');
        } catch (e) {
            assert.strictEqual(e.status, 1);
        }
    });
});
