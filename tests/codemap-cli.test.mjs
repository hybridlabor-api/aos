import test from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

test('aos-map cli test', async (t) => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-map-test-'));
    const mapDir = path.join(tempHome, '.aos', 'map');
    fs.mkdirSync(mapDir, { recursive: true });
    fs.writeFileSync(path.join(mapDir, 'architecture.json'), JSON.stringify({
        nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c', file: 'c.js' }],
        edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }]
    }));

    const bin = path.resolve(process.cwd(), 'bin', 'aos-map.mjs');

    await t.test('overview', () => {
        const out = execSync(`node ${bin} overview`, { cwd: tempHome }).toString();
        assert.match(out, /nodes/);
    });

    await t.test('find', () => {
        const out = execSync(`node ${bin} find a`, { cwd: tempHome }).toString();
        assert.match(out, /"id":"a"/);

        try {
            execSync(`node ${bin} find missing`, { cwd: tempHome });
            assert.fail('should exit 1 on missing find');
        } catch (e) {
            assert.strictEqual(e.status, 1);
        }
    });

    await t.test('show', () => {
        const outNodes = execSync(`node ${bin} show nodes`, { cwd: tempHome }).toString();
        assert.match(outNodes, /"id": "a"/);

        const outSpecific = execSync(`node ${bin} show a`, { cwd: tempHome }).toString();
        assert.match(outSpecific, /"id": "a"/);

        const outSpecificFile = execSync(`node ${bin} show c.js`, { cwd: tempHome }).toString();
        assert.match(outSpecificFile, /"id": "c"/);

        try {
            execSync(`node ${bin} show missing`, { cwd: tempHome });
            assert.fail('should exit 1 on missing show');
        } catch (e) {
            assert.strictEqual(e.status, 1);
        }
    });

    await t.test('path', () => {
        const out = execSync(`node ${bin} path a c`, { cwd: tempHome }).toString();
        assert.match(out, /Path from a to c: a -> b -> c/);

        try {
            execSync(`node ${bin} path a missing`, { cwd: tempHome });
            assert.fail('should exit 1 on missing path');
        } catch (e) {
            assert.strictEqual(e.status, 1);
        }
    });
});
