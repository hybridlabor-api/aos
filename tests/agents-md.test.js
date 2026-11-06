const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function execWithEnv(cmd, env) {
    execSync(cmd, { env, stdio: 'pipe', timeout: 100000 });
}

test('AGENTS.md is removed on uninstall if unedited', (t) => {
    const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-home-'));
    const testEnv = { ...process.env, HOME, USERPROFILE: HOME };
    const repoRoot = path.resolve(__dirname, '..');

    execWithEnv(`node ${path.join(repoRoot, 'installer.js')} -y`, testEnv);

    const manifestPath = path.join(HOME, '.agents', '.bdb-install-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(manifest[path.join(HOME, 'AGENTS.md')], 'AGENTS.md should be in the install manifest');
    assert.ok(fs.existsSync(path.join(HOME, 'AGENTS.md')), 'AGENTS.md should exist in HOME');

    execWithEnv(`node ${path.join(repoRoot, 'bin', 'aos-uninstall.mjs')} -y`, testEnv);
    assert.ok(!fs.existsSync(path.join(HOME, 'AGENTS.md')), 'AGENTS.md should be removed by uninstall');
});

test('AGENTS.md is kept and backed up on uninstall if edited', (t) => {
    const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-home-'));
    const testEnv = { ...process.env, HOME, USERPROFILE: HOME };
    const repoRoot = path.resolve(__dirname, '..');

    execWithEnv(`node ${path.join(repoRoot, 'installer.js')} -y`, testEnv);

    fs.appendFileSync(path.join(HOME, 'AGENTS.md'), '\nUser Edit Here');

    execWithEnv(`node ${path.join(repoRoot, 'bin', 'aos-uninstall.mjs')} -y`, testEnv);
    assert.ok(fs.existsSync(path.join(HOME, 'AGENTS.md')), 'AGENTS.md should be kept by uninstall if edited');
});

test('edited AGENTS.md is kept in place and a .bak copy is written on uninstall', (t) => {
    const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-home-'));
    const testEnv = { ...process.env, HOME, USERPROFILE: HOME };
    const repoRoot = path.resolve(__dirname, '..');

    const original = '# Global Agent Rules\n';
    const agentsMd = path.join(HOME, 'AGENTS.md');
    fs.writeFileSync(agentsMd, original);
    fs.mkdirSync(path.join(HOME, '.agents'), { recursive: true });
    const sha256 = require('crypto').createHash('sha256').update(original).digest('hex');
    fs.writeFileSync(path.join(HOME, '.agents', '.bdb-install-manifest.json'),
        JSON.stringify({ [agentsMd]: { sha256 } }));
    fs.appendFileSync(agentsMd, '\nUser Edit Here');

    execWithEnv(`node ${path.join(repoRoot, 'bin', 'aos-uninstall.mjs')} --yes`, testEnv);
    assert.ok(fs.existsSync(path.join(HOME, 'AGENTS.md')), 'edited AGENTS.md should stay in place');
    const baks = fs.readdirSync(HOME).filter((n) => n.startsWith('AGENTS.md.') && n.endsWith('.bak'));
    assert.strictEqual(baks.length, 1, 'edited AGENTS.md should have one .bak copy');
    assert.ok(fs.readFileSync(path.join(HOME, baks[0]), 'utf8').includes('User Edit Here'), '.bak should hold the edited content');
});

test('pre-existing user AGENTS.md not in manifest is kept on uninstall', (t) => {
    const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-home-'));
    const testEnv = { ...process.env, HOME, USERPROFILE: HOME };
    const repoRoot = path.resolve(__dirname, '..');

    // Create a pre-existing user AGENTS.md before install
    fs.writeFileSync(path.join(HOME, 'AGENTS.md'), '# My own AGENTS.md\nDo not delete.');

    execWithEnv(`node ${path.join(repoRoot, 'installer.js')} -y`, testEnv);

    execWithEnv(`node ${path.join(repoRoot, 'bin', 'aos-uninstall.mjs')} -y`, testEnv);
    assert.ok(fs.existsSync(path.join(HOME, 'AGENTS.md')), 'pre-existing user AGENTS.md should be kept on uninstall');
    assert.ok(fs.readFileSync(path.join(HOME, 'AGENTS.md'), 'utf8').includes('My own AGENTS.md'), 'user content should be preserved');
});
