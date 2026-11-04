const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const INSTALLER = path.join(__dirname, '..', 'installer.js');

test('aos project init --files creates project rule files correctly', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-project-init-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-project-init-home-'));

    // Write fake AGENTS.template.md for test since it depends on srcDir
    const srcDir = path.join(__dirname, '..');

    const r = spawnSync(process.execPath, [INSTALLER, 'project', 'init', '--files'], {
        cwd, env: { ...process.env, HOME: home, USERPROFILE: home, AOS_TEST_DRY_RUN: '0' }, encoding: 'utf8', timeout: 120000,
    });

    assert.equal(r.status, 0, r.stderr);

    const pAgents = path.join(cwd, 'AGENTS.md');
    const pClaude = path.join(cwd, 'CLAUDE.md');
    const pGemini = path.join(cwd, 'GEMINI.md');

    assert.ok(fs.existsSync(pAgents), 'AGENTS.md created');
    assert.ok(fs.existsSync(pClaude), 'CLAUDE.md created');
    assert.ok(fs.existsSync(pGemini), 'GEMINI.md created');

    const agentsContent = fs.readFileSync(pAgents, 'utf8');
    assert.ok(agentsContent.includes(path.basename(cwd)), 'AGENTS.md should have the project name (cwd basename)');

    // Check if CLAUDE and GEMINI are symlinks or have pointer text
    if (process.platform !== 'win32') {
        const cStat = fs.lstatSync(pClaude);
        const gStat = fs.lstatSync(pGemini);
        assert.ok(cStat.isSymbolicLink() || fs.readFileSync(pClaude, 'utf8').includes('**See [AGENTS.md]'), 'CLAUDE.md is symlink or pointer');
        assert.ok(gStat.isSymbolicLink() || fs.readFileSync(pGemini, 'utf8').includes('**See [AGENTS.md]'), 'GEMINI.md is symlink or pointer');
    } else {
        assert.ok(fs.readFileSync(pClaude, 'utf8').includes('**See [AGENTS.md]'), 'CLAUDE.md has pointer text');
        assert.ok(fs.readFileSync(pGemini, 'utf8').includes('**See [AGENTS.md]'), 'GEMINI.md has pointer text');
    }

    // Now test idempotency (running again should skip)
    const r2 = spawnSync(process.execPath, [INSTALLER, 'project', 'init', '--files'], {
        cwd, env: { ...process.env, HOME: home, USERPROFILE: home, AOS_TEST_DRY_RUN: '0' }, encoding: 'utf8', timeout: 120000,
    });

    assert.equal(r2.status, 0, r2.stderr);
    assert.ok(r2.stdout.includes('Skipped'), 'Should skip existing files');

    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
});

test('aos project without init --files stops and never falls through to the install', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-project-bad-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-project-bad-home-'));
    try {
        for (const args of [['project'], ['project', 'init'], ['project', 'list', '--files']]) {
            const r = spawnSync(process.execPath, [INSTALLER, ...args], {
                cwd, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', timeout: 120000,
            });
            assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
            assert.deepEqual(fs.readdirSync(cwd), [], `${args.join(' ')} wrote into the project`);
            assert.deepEqual(fs.readdirSync(home), [], `${args.join(' ')} wrote into HOME`);
        }
    } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    }
});
