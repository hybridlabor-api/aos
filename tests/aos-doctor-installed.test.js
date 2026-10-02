const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const write = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

// The doctor as installed (~/.agents/bin + ~/.agents/lib, no installer.js beside it) in a sandbox HOME.
test('installed doctor with an AO checkout, a nested plugin cache and named agy hooks', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-doc-'));
    try {
        fs.mkdirSync(path.join(home, 'empty-bin'));
        fs.cpSync(path.join(REPO, 'lib'), path.join(home, '.agents', 'lib'), { recursive: true });
        fs.mkdirSync(path.join(home, '.agents', 'bin'), { recursive: true });
        fs.copyFileSync(path.join(REPO, 'bin', 'aos-doctor.mjs'), path.join(home, '.agents', 'bin', 'aos-doctor.mjs'));
        write(path.join(home, '.local', 'bin', 'ao'), 'not a real ao');
        fs.mkdirSync(path.join(home, 'dev', 'agents', 'bdb-agent-orchestrator', '.git'), { recursive: true });
        const root = path.join(home, '.claude', 'plugins', 'cache', 'bdb-marketplace', 'bdb-aos', '1.0.0');
        write(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ skills: ['./skills/basic/startcycle'] }));
        write(path.join(root, 'skills', 'basic', 'startcycle', 'SKILL.md'), '#');
        write(path.join(home, '.gemini', 'config', 'hooks.json'), JSON.stringify({ 'aos-context': { PreInvocation: [] }, 'aos-go-gate': { PreToolUse: [] } }));
        write(path.join(home, '.gemini', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { mcsc: { command: 'node' } } }));

        const r = spawnSync(process.execPath, [path.join(home, '.agents', 'bin', 'aos-doctor.mjs'), '--json'], { cwd: home, env: { HOME: home, USERPROFILE: home, PATH: path.join(home, 'empty-bin') }, encoding: 'utf8' });
        assert.ok(r.stdout, `doctor crashed: ${r.stderr}`);
        const res = JSON.parse(r.stdout).results;
        const by = (n) => res.find((x) => x.name === n);
        assert.ok(by('AO revision vs checkout'), 'checkout path ran without requiring ../installer.js');
        const claude = by('Claude Code Skills');
        assert.ok(claude.ok && /provided by the bdb-aos plugin \(1 skills\)/.test(claude.detail), claude.detail);
        assert.ok(by('Antigravity hooks').ok && /2\/6 named/.test(by('Antigravity hooks').detail), by('Antigravity hooks').detail);
        const mcsc = by('MCSC Telemetry Registration');
        assert.ok(mcsc.ok && mcsc.detail.includes('mcp_config.json'), mcsc.detail);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
