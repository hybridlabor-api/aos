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
    assert.ok(fs.existsSync(path.join(cwd, '.aos', 'project.json')), '.aos/project.json created');
    assert.ok(fs.existsSync(path.join(cwd, '.openwikiignore')), '.openwikiignore written for a fresh project');
    for (const n of ['RULES.md', 'CODEX.md']) assert.ok(fs.readFileSync(path.join(cwd, n), 'utf8').includes('AGENTS.md'), n + ' points to AGENTS.md');
    assert.ok(fs.existsSync(path.join(cwd, '.aos', 'evals')), '.aos/evals created');

    const agentsContent = fs.readFileSync(pAgents, 'utf8');
    assert.ok(agentsContent.includes(path.basename(cwd)), 'AGENTS.md should have the project name (cwd basename)');
    assert.ok(agentsContent.includes('## Build and test commands'), 'AGENTS.md should have Build and test commands section');
    assert.ok(agentsContent.includes('## Code style'), 'AGENTS.md should have Code style section');
    assert.ok(agentsContent.includes('## CI'), 'AGENTS.md should have CI section');
    assert.ok(agentsContent.includes('## Non-negotiable'), 'AGENTS.md carries the Non-negotiable rules');
    assert.ok(agentsContent.includes('<!-- aos:destructive-actions:start -->'), 'AGENTS.md carries the Destructive Actions block');
    assert.ok(agentsContent.includes('## Local map'), 'AGENTS.md has a Local map section');
    assert.ok(agentsContent.includes('## Commits'), 'AGENTS.md should have Commits section');
    assert.ok(agentsContent.includes('## PRs'), 'AGENTS.md should have PRs section');
    assert.ok(agentsContent.includes('## Security'), 'AGENTS.md should have Security section');
    assert.ok(agentsContent.includes('Nested `AGENTS.md` files take precedence'), 'AGENTS.md should have monorepo precedence note');

    // output should include the plan printed first
    assert.ok(r.stdout.includes('Project init plan:'), 'Should print a plan');
    assert.ok(r.stdout.includes(`Wrote ${pAgents}`), 'Should plan to write AGENTS.md');

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

    // modify project.json to verify it isn't overwritten without flag
    fs.writeFileSync(path.join(cwd, '.aos', 'project.json'), '{"custom": 123}');

    const r3 = spawnSync(process.execPath, [INSTALLER, 'project', 'init', '--files'], {
        cwd, env: { ...process.env, HOME: home, USERPROFILE: home, AOS_TEST_DRY_RUN: '0' }, encoding: 'utf8', timeout: 120000,
    });
    assert.equal(r3.status, 0, r3.stderr);
    assert.equal(fs.readFileSync(path.join(cwd, '.aos', 'project.json'), 'utf8'), '{"custom": 123}');

    // modify AGENTS.md manually to check backup
    fs.writeFileSync(pAgents, 'Modified agents content');

    // now test with --force
    const r4 = spawnSync(process.execPath, [INSTALLER, 'project', 'init', '--files', '--force'], {
        cwd, env: { ...process.env, HOME: home, USERPROFILE: home, AOS_TEST_DRY_RUN: '0' }, encoding: 'utf8', timeout: 120000,
    });

    assert.equal(r4.status, 0, r4.stderr);
    assert.ok(r4.stdout.includes('Wrote'), 'Should write existing files with --force');
    assert.ok(fs.existsSync(`${pAgents}.bak`), 'Should create AGENTS.md backup');
    assert.equal(fs.readFileSync(`${pAgents}.bak`, 'utf8'), 'Modified agents content', 'Backup content matches');

    const projectJson = JSON.parse(fs.readFileSync(path.join(cwd, '.aos', 'project.json'), 'utf8'));
    assert.equal(projectJson.name, path.basename(cwd));
    assert.equal(typeof projectJson.slug, 'string');
    assert.match(projectJson.slug, /^[a-z0-9-]+$/);

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
