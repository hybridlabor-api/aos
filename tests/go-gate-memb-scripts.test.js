// The three memB entry scripts are exempt from the fresh-script analysis, by exact dir + basename only.
const { test, describe, beforeEach, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const GATE = path.resolve(__dirname, '..', '.claude', 'hooks', 'go-gate.mjs');
const BASE = String(process.env.HOME || '').startsWith('/private/tmp/') ? process.env.HOME : os.tmpdir();
process.env.AOS_TEST_SANDBOX = '1';

let g, home, work, ctx;
before(async () => { g = await import(pathToFileURL(GATE).href); });
beforeEach(() => {
    home = fs.mkdtempSync(path.join(BASE, 'aos-memb-'));
    work = path.join(home, 'projects', 'work');
    fs.mkdirSync(work, { recursive: true });
    process.env.AOS_GATE_TEST_REALHOME = home;
    ctx = { cwd: work, blockTs: 0, home, realHome: home, claudeDir: path.join(home, '.claude') };
    g.setGateContext(ctx);
});

const RM = 'import shutil, sys\nshutil.rmtree(sys.argv[1])\n';
const put = (dir, name) => { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, name); fs.writeFileSync(f, RM); return f; };
const sc = (c) => g.commandScopes(c);

describe('memB scripts and the cooldown', () => {
    const mcpDir = () => path.join(home, '.gemini', 'config', 'mcps', 'memb-mcp');

    test('a fresh memb_ingest.py in the memB dir is not analysed', () => {
        const f = put(mcpDir(), 'memb_ingest.py');
        assert.deepEqual(sc(`python3 ${f} /some/dir --transcripts`), []);
    });
    test('also right after a block (cooldown window)', () => {
        const f = put(mcpDir(), 'memb_ingest.py');
        g.setGateContext({ ...ctx, blockTs: Date.now() - 1000 });
        assert.deepEqual(sc(`python3 ${f} /some/dir --transcripts`), []);
    });
    test('the ~/.agents/memB dir and run.py / memb_auto_inject.py are exempt too', () => {
        for (const [d, n] of [[path.join(home, '.agents', 'memB'), 'run.py'], [mcpDir(), 'memb_auto_inject.py']]) {
            assert.deepEqual(sc(`python3 ${put(d, n)}`), [], n);
        }
    });
    test('the same content in another dir, or another name in the memB dir, is still analysed', () => {
        assert.notDeepEqual(sc(`python3 ${put(path.join(home, '.gemini', 'config', 'mcps', 'other'), 'memb_ingest.py')}`), []);
        assert.notDeepEqual(sc(`python3 ${put(work, 'memb_ingest.py')}`), []);
        assert.notDeepEqual(sc(`python3 ${put(mcpDir(), 'evil.py')}`), []);
        assert.notDeepEqual(sc(`python3 ${put(path.join(mcpDir(), 'sub'), 'run.py')}`), []);
    });
});
