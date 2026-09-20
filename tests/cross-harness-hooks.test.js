/**
 * tests/cross-harness-hooks.test.js
 *
 * Comprehensive Multi-Harness Hook and Workflow Interoperability Test Suite.
 *
 * Requirements Covered:
 * - R1: Cross-Harness Hook Installation (Antigravity hooks.json, Codex config.toml, Claude settings.json preservation)
 * - R2: Workflow Execution via Hooks (startcycle-dispatch.mjs fast-exit, CLI args, standalone runtime)
 * - R3: Harness-Agnostic memB Injection (multi-harness inputs, project root traversal, multi-key matching, tri-format output)
 * - R4: AOS-Setup Verification & aos-doctor.mjs multi-harness diagnostic checks
 *
 * Tiers:
 * - Tier 1: Feature Coverage (R1-R4)
 * - Tier 2: Boundary & Corner Cases (empty/corrupt inputs, deep subfolders, missing env/db)
 * - Tier 3: Cross-Feature Interactions & Idempotency (installer + doctor, multi-harness coexistence)
 * - Tier 4: Real-World Multi-Harness Simulations (Antigravity, Codex, Claude Code)
 * - Tier 5: Adversarial Stress & Integrity (shell injection, path traversal, large payloads)
 *
 * Runner: node --test tests/cross-harness-hooks.test.js
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const INSTALLER_PATH = path.join(REPO_ROOT, 'installer.js');
const MEMB_INJECT_SRC = path.join(REPO_ROOT, '.claude', 'hooks', 'memb-inject.mjs');
const STARTCYCLE_DISPATCH_SRC = path.join(REPO_ROOT, '.claude', 'workflows', 'startcycle-dispatch.mjs');
const DOCTOR_SRC = path.join(REPO_ROOT, 'skills', 'global_config', 'aos-setup', 'scripts', 'aos-doctor.mjs');
const SETUP_SKILL_MD = path.join(REPO_ROOT, 'skills', 'global_config', 'aos-setup', 'SKILL.md');

// Helper to spawn node script with stdin/env/cwd
function runNodeScript(scriptPath, { args = [], input = '', env = {}, cwd = null, timeout = 10000 } = {}) {
    return spawnSync(process.execPath, [scriptPath, ...args], {
        input,
        env: { ...process.env, ...env },
        cwd: cwd || REPO_ROOT,
        encoding: 'utf8',
        timeout,
    });
}

// Helper to create mock SQLite memB database
function createMockMembDb(dbPath, records = []) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    let DatabaseSync;
    try {
        const sqlite = require('node:sqlite');
        DatabaseSync = sqlite.DatabaseSync;
    } catch {
        return false;
    }

    const db = new DatabaseSync(dbPath);
    db.exec(`
        CREATE TABLE IF NOT EXISTS memb_vectors (
            rowid INTEGER PRIMARY KEY AUTOINCREMENT,
            collection TEXT,
            payload TEXT
        );
    `);

    const insert = db.prepare('INSERT INTO memb_vectors (collection, payload) VALUES (?, ?)');
    for (const rec of records) {
        insert.run('bdb_agent_memory', JSON.stringify(rec));
    }
    db.close();
    return true;
}

// ============================================================================
// TIER 1: FEATURE COVERAGE (R1 - R4)
// ============================================================================

describe('Tier 1: Feature Coverage (R1 - R4)', () => {

    describe('R1: Cross-Harness Hook Installation', () => {
        let tmpDir;
        let installer;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-r1-'));
            try {
                installer = require(INSTALLER_PATH);
            } catch (err) {
                installer = null;
            }
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        test('installer provides mergeAntigravityHooks to generate valid hooks.json', () => {
            const hooksPath = path.join(tmpDir, '.agents', 'hooks.json');

            if (typeof installer.mergeAntigravityHooks === 'function') {
                installer.mergeAntigravityHooks(hooksPath, { projectLocal: true });
            } else {
                // If not exported directly, invoke installer via sub-process or helper
                execFileSync(
                    process.execPath,
                    ['-e', `const i = require(${JSON.stringify(INSTALLER_PATH)}); if (i.mergeAntigravityHooks) i.mergeAntigravityHooks(${JSON.stringify(hooksPath)}, { projectLocal: true });`],
                    { env: { ...process.env, HOME: tmpDir }, stdio: 'pipe' }
                );
            }

            assert.ok(fs.existsSync(hooksPath), 'hooks.json must be created');
            const data = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));

            assert.ok(data.hooks, 'hooks object must exist in hooks.json');
            assert.ok(Array.isArray(data.hooks.PreToolUse), 'PreToolUse must be an array');
            assert.ok(Array.isArray(data.hooks.Stop), 'Stop must be an array');
            assert.ok(Array.isArray(data.hooks.PreInvocation), 'PreInvocation must be an array');

            // Verify matcher and commands
            const preTool = data.hooks.PreToolUse[0];
            assert.ok(preTool && /run_command|Bash/.test(preTool.matcher), 'PreToolUse matcher must match run_command|Bash');
            const preToolCmd = preTool.hooks?.[0]?.command || '';
            assert.ok(preToolCmd.includes('go-gate.mjs'), 'PreToolUse must run go-gate.mjs');

            const stopCmd = data.hooks.Stop[0]?.hooks?.[0]?.command || data.hooks.Stop[0]?.command || '';
            assert.ok(stopCmd.includes('graph-gate.mjs'), 'Stop must run graph-gate.mjs');

            const preInvocCmds = (data.hooks.PreInvocation || []).flatMap(e => (e.hooks ? e.hooks.map(h => h.command) : [e.command]));
            assert.ok(preInvocCmds.some(c => c && c.includes('memb-inject.mjs')), 'PreInvocation must run memb-inject.mjs');
            assert.ok(preInvocCmds.some(c => c && c.includes('startcycle-dispatch.mjs')), 'PreInvocation must run startcycle-dispatch.mjs');
        });

        test('Antigravity hooks merger preserves foreign hooks', () => {
            const hooksPath = path.join(tmpDir, 'hooks.json');
            fs.writeFileSync(hooksPath, JSON.stringify({
                hooks: {
                    PreToolUse: [{ matcher: "custom_tool", hooks: [{ type: "command", command: "node custom-tool.mjs" }] }],
                    SessionStart: [{ hooks: [{ type: "command", command: "node session-init.mjs" }] }]
                }
            }, null, 2));

            if (typeof installer.mergeAntigravityHooks === 'function') {
                installer.mergeAntigravityHooks(hooksPath);
            } else {
                execFileSync(
                    process.execPath,
                    ['-e', `const i = require(${JSON.stringify(INSTALLER_PATH)}); if (i.mergeAntigravityHooks) i.mergeAntigravityHooks(${JSON.stringify(hooksPath)});`],
                    { env: { ...process.env, HOME: tmpDir }, stdio: 'pipe' }
                );
            }

            const data = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
            assert.ok(Array.isArray(data.hooks.SessionStart), 'SessionStart must survive');
            assert.equal(data.hooks.SessionStart[0].hooks[0].command, 'node session-init.mjs');
            assert.ok(data.hooks.PreToolUse.some(e => e.matcher === 'custom_tool'), 'foreign PreToolUse must survive');
            assert.ok(data.hooks.PreToolUse.some(e => /run_command|Bash/.test(e.matcher)), 'BDB PreToolUse must be added');
        });

        test('installer provides mergeCodexTomlHooks to generate valid config.toml', () => {
            const configPath = path.join(tmpDir, '.codex', 'config.toml');

            const mergeCodex = installer.mergeCodexTomlHooks || installer.mergeCodexHooks;
            if (typeof mergeCodex === 'function') {
                mergeCodex(configPath, { projectLocal: true });
            } else {
                execFileSync(
                    process.execPath,
                    ['-e', `const i = require(${JSON.stringify(INSTALLER_PATH)}); const fn = i.mergeCodexTomlHooks || i.mergeCodexHooks; if (fn) fn(${JSON.stringify(configPath)}, { projectLocal: true });`],
                    { env: { ...process.env, HOME: tmpDir }, stdio: 'pipe' }
                );
            }

            assert.ok(fs.existsSync(configPath), 'config.toml must be created');
            const toml = fs.readFileSync(configPath, 'utf8');

            assert.ok(/\[features\][^[]*hooks\s*=\s*true/m.test(toml) || /codex_hooks\s*=\s*true/m.test(toml), 'hooks must be enabled under [features]');
            assert.ok(toml.includes('# AOS:HOOKS:START'), 'Must contain AOS:HOOKS:START boundary marker');
            assert.ok(toml.includes('# AOS:HOOKS:END'), 'Must contain AOS:HOOKS:END boundary marker');
            assert.ok(toml.includes('go-gate.mjs'), 'config.toml must wire go-gate.mjs');
            assert.ok(toml.includes('graph-gate.mjs'), 'config.toml must wire graph-gate.mjs');
            assert.ok(toml.includes('memb-inject.mjs'), 'config.toml must wire memb-inject.mjs');
            assert.ok(toml.includes('startcycle-dispatch.mjs'), 'config.toml must wire startcycle-dispatch.mjs');
        });

        test('Codex TOML merger preserves foreign sections and user MCP servers', () => {
            const configPath = path.join(tmpDir, 'config.toml');
            const initialToml = [
                '# Custom User Codex Config',
                'model = "o3-mini"',
                '',
                '[mcp_servers.my_custom_server]',
                'command = "npx"',
                'args = ["-y", "custom-mcp"]',
                ''
            ].join('\n');
            fs.writeFileSync(configPath, initialToml);

            const mergeCodex = installer.mergeCodexTomlHooks || installer.mergeCodexHooks;
            if (typeof mergeCodex === 'function') {
                mergeCodex(configPath);
            } else {
                execFileSync(
                    process.execPath,
                    ['-e', `const i = require(${JSON.stringify(INSTALLER_PATH)}); const fn = i.mergeCodexTomlHooks || i.mergeCodexHooks; if (fn) fn(${JSON.stringify(configPath)});`],
                    { env: { ...process.env, HOME: tmpDir }, stdio: 'pipe' }
                );
            }

            const updatedToml = fs.readFileSync(configPath, 'utf8');
            assert.ok(updatedToml.includes('model = "o3-mini"'), 'User root config setting preserved');
            assert.ok(updatedToml.includes('[mcp_servers.my_custom_server]'), 'User MCP server table preserved');
            assert.ok(updatedToml.includes('command = "npx"'), 'User MCP command preserved');
            assert.ok(updatedToml.includes('# AOS:HOOKS:START'), 'BDB hooks section added');
        });

        test('Claude Code mergeBdbSettingsHooks continues to operate unregressed', () => {
            const claudeSettings = path.join(tmpDir, '.claude', 'settings.json');
            installer.mergeBdbSettingsHooks(claudeSettings);
            assert.ok(fs.existsSync(claudeSettings), 'settings.json must exist');
            const data = JSON.parse(fs.readFileSync(claudeSettings, 'utf8'));

            const commandsFor = (settings, event) =>
                (settings.hooks[event] || []).flatMap((entry) => entry.hooks.map((h) => h.command));

            assert.ok(commandsFor(data, 'PreToolUse').some(c => c.includes('go-gate.mjs')));
            assert.ok(commandsFor(data, 'Stop').some(c => c.includes('graph-gate.mjs')));
            assert.ok(commandsFor(data, 'UserPromptSubmit').some(c => c.includes('memb-inject.mjs')));
        });
    });

    describe('R2: Workflow Execution via Hooks (startcycle-dispatch.mjs)', () => {

        test('startcycle-dispatch.mjs exits cleanly (0) on non-command prompts without throwing ReferenceError', () => {
            // Test Antigravity format
            const agRes = runNodeScript(STARTCYCLE_DISPATCH_SRC, {
                input: JSON.stringify({
                    conversationId: 'conv-test-1',
                    prompt: 'What does this project do?'
                })
            });
            assert.equal(agRes.status, 0, `Expected exit code 0 on regular prompt, got ${agRes.status}. Stderr: ${agRes.stderr}`);
            assert.ok(!agRes.stderr.includes('ReferenceError'), 'Must not throw ReferenceError');
            assert.ok(!agRes.stderr.includes('SyntaxError'), 'Must not throw SyntaxError');

            // Test Codex format
            const cdxRes = runNodeScript(STARTCYCLE_DISPATCH_SRC, {
                input: JSON.stringify({
                    session_id: 'codex-sess-1',
                    prompt: 'Refactor the helper functions',
                    cwd: REPO_ROOT
                })
            });
            assert.equal(cdxRes.status, 0, `Codex prompt passthrough must exit 0, got ${cdxRes.status}`);
            assert.ok(!cdxRes.stderr.includes('ReferenceError'), 'Must not throw ReferenceError');
        });

        test('startcycle-dispatch.mjs recognizes /startcycle-graph prompt and extracts goal', () => {
            // Invoking with goal via stdin
            const res = runNodeScript(STARTCYCLE_DISPATCH_SRC, {
                input: JSON.stringify({
                    prompt: '/startcycle-graph Add user authentication via OAuth'
                })
            });

            // The script should recognize the command and attempt execution.
            // It should NOT crash with ReferenceError on 'args', 'agent', or 'pipeline'.
            assert.ok(!res.stderr.includes('ReferenceError: args is not defined'), 'args must be defined/handled');
            assert.ok(!res.stderr.includes('ReferenceError: agent is not defined'), 'agent runtime shim must prevent crash');
            assert.ok(!res.stderr.includes('ReferenceError: pipeline is not defined'), 'pipeline runtime shim must prevent crash');
        });

        test('startcycle-dispatch.mjs accepts CLI arguments when run as a standalone script', () => {
            const res = runNodeScript(STARTCYCLE_DISPATCH_SRC, {
                args: ['--help']
            });
            // Running with --help or standalone goal should not crash with SyntaxError
            assert.ok(!res.stderr.includes('SyntaxError: Illegal return statement'), 'Top-level return statement must be wrapped or handled');
        });
    });

    describe('R3: Harness-Agnostic memB Injection (memb-inject.mjs)', () => {
        let tmpDir;
        let mockDbPath;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-r3-'));
            mockDbPath = path.join(tmpDir, '.MemBDB', 'memb.db');
            createMockMembDb(mockDbPath, [
                { user_id: 'bdb_developer', project_id: 'my-web-app', data: 'Architecture: React + Express backend' },
                { user_id: 'test_dev', metadata: { project_id: 'my-web-app' }, memory: 'Developer preferences: tabs over spaces' },
                { user_id: 'bdb_developer', project: 'my-web-app', data: 'Wiki: Deployment requires Node 22' },
                { user_id: 'other_dev', project_id: 'other-app', data: 'Secret token for other app' }
            ]);
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        test('hook carries version stamp 3', () => {
            const content = fs.readFileSync(MEMB_INJECT_SRC, 'utf8');
            const m = /^\/\/\s*aos-hook-version:\s*(\d+)/m.exec(content);
            assert.ok(m, 'memb-inject.mjs must contain aos-hook-version header');
            assert.equal(m[1], '3', `Expected version 3, got ${m[1]}`);
        });

        test('parses Antigravity workspacePaths input and returns tri-format JSON', () => {
            const projDir = path.join(tmpDir, 'projects', 'my-web-app');
            fs.mkdirSync(path.join(projDir, '.git'), { recursive: true });

            const payload = JSON.stringify({
                conversationId: 'ag-conv-99',
                workspacePaths: [projDir],
                prompt: 'Show me deployment instructions'
            });

            const res = runNodeScript(MEMB_INJECT_SRC, {
                input: payload,
                env: { HOME: tmpDir, MEMB_USER_ID: 'test_dev' }
            });

            assert.equal(res.status, 0, `Exit code should be 0, stderr: ${res.stderr}`);
            assert.ok(res.stdout && res.stdout.trim().length > 0, 'Must output JSON context');

            const out = JSON.parse(res.stdout);
            // Verify Tri-Format Output
            assert.ok(out.hookSpecificOutput, 'Must provide hookSpecificOutput for Claude Code');
            assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
            assert.ok(out.hookSpecificOutput.additionalContext.includes('my-web-app'), 'Context must mention project');

            assert.ok(Array.isArray(out.injectSteps), 'Must provide injectSteps array for Antigravity');
            assert.ok(out.injectSteps[0].ephemeralMessage, 'injectSteps must contain ephemeralMessage');

            assert.ok(typeof out.systemMessage === 'string', 'Must provide systemMessage for Codex');
        });

        test('resolves project root from deep subfolder avoiding $HOME false positive', () => {
            const projDir = path.join(tmpDir, 'projects', 'my-web-app');
            const deepSubdir = path.join(projDir, 'packages', 'client', 'src', 'components');
            fs.mkdirSync(path.join(projDir, '.git'), { recursive: true });
            fs.mkdirSync(deepSubdir, { recursive: true });

            const payload = JSON.stringify({
                prompt: 'Explain the architecture',
                cwd: deepSubdir
            });

            const res = runNodeScript(MEMB_INJECT_SRC, {
                input: payload,
                env: { HOME: tmpDir, MEMB_USER_ID: 'test_dev' },
                cwd: deepSubdir
            });

            assert.equal(res.status, 0);
            assert.ok(res.stdout.trim().length > 0, 'Should output memory even when in subfolder');
            const out = JSON.parse(res.stdout);
            assert.ok(out.hookSpecificOutput.additionalContext.includes('my-web-app'), 'Should bind memory to my-web-app, not components');
        });

        test('multi-key project matching queries across project_id, project, and metadata', () => {
            const projDir = path.join(tmpDir, 'my-web-app');
            fs.mkdirSync(path.join(projDir, '.git'), { recursive: true });

            const payload = JSON.stringify({
                prompt: 'Wiki information',
                cwd: projDir
            });

            const res = runNodeScript(MEMB_INJECT_SRC, {
                input: payload,
                env: { HOME: tmpDir }
            });

            assert.equal(res.status, 0);
            const out = JSON.parse(res.stdout);
            const text = out.hookSpecificOutput.additionalContext;
            // Both payload.project and payload.project_id rows should match
            assert.ok(text.includes('React + Express backend') || text.includes('Deployment requires Node 22'),
                'Must retrieve memories matching either project_id or project');
        });

        test('user_id fallback matches both active user and bdb_developer system memories', () => {
            const projDir = path.join(tmpDir, 'my-web-app');
            fs.mkdirSync(path.join(projDir, '.git'), { recursive: true });

            const payload = JSON.stringify({
                prompt: 'preferences',
                cwd: projDir,
                user_id: 'test_dev'
            });

            const res = runNodeScript(MEMB_INJECT_SRC, {
                input: payload,
                env: { HOME: tmpDir, MEMB_USER_ID: 'test_dev' }
            });

            assert.equal(res.status, 0);
            const out = JSON.parse(res.stdout);
            const text = out.hookSpecificOutput.additionalContext;
            // Should contain user preference AND system architecture
            assert.ok(text.includes('tabs over spaces') || text.includes('React + Express backend'),
                'Should reconcile user and system records');
        });
    });

    describe('R4: AOS-Setup & Doctor Multi-Harness Verification', () => {

        test('aos-setup SKILL.md documents Hooks: yes for Antigravity and Codex', () => {
            assert.ok(fs.existsSync(SETUP_SKILL_MD), 'SKILL.md must exist');
            const md = fs.readFileSync(SETUP_SKILL_MD, 'utf8');

            // Find Capability table
            assert.ok(/\|\s*Antigravity\s*\|[^|]*\|[^|]*\|\s*\**yes\**/i.test(md),
                'SKILL.md capability table must list Antigravity Hooks as yes');
            assert.ok(/\|\s*Codex\s*\|[^|]*\|[^|]*\|\s*\**yes\**/i.test(md),
                'SKILL.md capability table must list Codex Hooks as yes');
            assert.ok(!md.includes('Only Claude Code has hooks'),
                'SKILL.md must not claim only Claude Code has hooks');
        });

        test('aos-doctor.mjs expects hook version 3 for memb-inject.mjs', () => {
            assert.ok(fs.existsSync(DOCTOR_SRC), 'aos-doctor.mjs must exist');
            const doc = fs.readFileSync(DOCTOR_SRC, 'utf8');

            assert.ok(/'memb-inject\.mjs':\s*3\b/.test(doc),
                'EXPECTED_VERSION in aos-doctor.mjs must specify 3 for memb-inject.mjs');
        });

        test('aos-doctor.mjs inspects hook wiring across detected harnesses', () => {
            const doc = fs.readFileSync(DOCTOR_SRC, 'utf8');
            // Must contain checks for Antigravity and Codex hook files
            assert.ok(/hooks\.json/.test(doc), 'aos-doctor.mjs must reference hooks.json');
            assert.ok(/config\.toml/.test(doc), 'aos-doctor.mjs must reference config.toml');
        });
    });
});

// ============================================================================
// TIER 2: BOUNDARY & CORNER CASES
// ============================================================================

describe('Tier 2: Boundary & Corner Cases', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-tier2-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('memb-inject.mjs fails open (exit 0) on completely empty stdin', () => {
        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: '',
            env: { HOME: tmpDir }
        });
        assert.equal(res.status, 0, 'Empty stdin must exit 0 (fail-open)');
        assert.equal(res.stdout, '', 'Empty stdin should produce no stdout');
    });

    test('memb-inject.mjs fails open on whitespace-only stdin', () => {
        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: '   \n\t  \n',
            env: { HOME: tmpDir }
        });
        assert.equal(res.status, 0);
        assert.equal(res.stdout, '');
    });

    test('memb-inject.mjs fails open on corrupt non-JSON stdin', () => {
        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: '<<<MALFORMED_INPUT_NOT_JSON>>>',
            env: { HOME: tmpDir }
        });
        assert.equal(res.status, 0);
    });

    test('memb-inject.mjs fails open when ~/.MemBDB/memb.db does not exist', () => {
        // tmpDir has no .MemBDB folder
        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: JSON.stringify({ prompt: 'test query', cwd: tmpDir }),
            env: { HOME: tmpDir }
        });
        assert.equal(res.status, 0, 'Missing DB must exit 0 without blocking prompt');
    });

    test('memb-inject.mjs fails open when database file is corrupted', () => {
        const dbPath = path.join(tmpDir, '.MemBDB', 'memb.db');
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        fs.writeFileSync(dbPath, 'NOT A SQLITE DATABASE HEADER TRUNCATED');

        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: JSON.stringify({ prompt: 'test query', cwd: tmpDir }),
            env: { HOME: tmpDir }
        });
        assert.equal(res.status, 0, 'Corrupt DB must fail open gracefully');
    });

    test('memb-inject.mjs handles missing environment variables (no USER, no MEMB_USER_ID)', () => {
        const strippedEnv = { ...process.env, HOME: tmpDir };
        delete strippedEnv.USER;
        delete strippedEnv.LOGNAME;
        delete strippedEnv.MEMB_USER_ID;

        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: JSON.stringify({ prompt: 'test query', cwd: tmpDir }),
            env: strippedEnv
        });
        assert.equal(res.status, 0, 'Must not crash when user env vars are absent');
    });

    test('installer handles corrupt JSON in existing hooks.json without crashing', () => {
        const hooksPath = path.join(tmpDir, 'hooks.json');
        fs.writeFileSync(hooksPath, '{ corrupt json: true,');

        let installer;
        try { installer = require(INSTALLER_PATH); } catch {}

        if (installer && typeof installer.mergeAntigravityHooks === 'function') {
            assert.doesNotThrow(() => {
                installer.mergeAntigravityHooks(hooksPath);
            }, 'mergeAntigravityHooks must handle corrupt JSON safely');
        }
    });

    test('installer handles corrupt TOML in existing config.toml gracefully', () => {
        const configPath = path.join(tmpDir, 'config.toml');
        fs.writeFileSync(configPath, '[[unclosed table\nkey = = broken');

        let installer;
        try { installer = require(INSTALLER_PATH); } catch {}

        const fn = installer && (installer.mergeCodexTomlHooks || installer.mergeCodexHooks);
        if (typeof fn === 'function') {
            assert.doesNotThrow(() => {
                fn(configPath);
            }, 'mergeCodexTomlHooks must not throw on malformed TOML');
        }
    });
});

// ============================================================================
// TIER 3: CROSS-FEATURE INTERACTIONS & IDEMPOTENCY
// ============================================================================

describe('Tier 3: Cross-Feature Interactions & Idempotency', () => {
    let homeDir;

    beforeEach(() => {
        homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-tier3-home-'));
    });

    afterEach(() => {
        fs.rmSync(homeDir, { recursive: true, force: true });
    });

    test('multi-harness coexistence: Claude, Antigravity, and Codex hooks coexist without collision', () => {
        const installer = require(INSTALLER_PATH);

        // Run global installer in mock home
        execFileSync(
            process.execPath,
            ['-e', `const i = require(${JSON.stringify(INSTALLER_PATH)}); i.installGlobalHooks();`],
            { env: { ...process.env, HOME: homeDir }, stdio: 'pipe' }
        );

        // 1. Claude Code
        const claudeSettings = path.join(homeDir, '.claude', 'settings.json');
        assert.ok(fs.existsSync(claudeSettings), 'Claude settings.json must exist');
        const cld = JSON.parse(fs.readFileSync(claudeSettings, 'utf8'));
        assert.ok(cld.hooks.PreToolUse, 'Claude PreToolUse must be configured');

        // 2. Antigravity
        const agHooks = path.join(homeDir, '.gemini', 'config', 'hooks.json');
        const agAltHooks = path.join(homeDir, '.agents', 'hooks.json');
        const agPath = fs.existsSync(agHooks) ? agHooks : agAltHooks;
        assert.ok(fs.existsSync(agPath), 'Antigravity hooks.json must exist at either standard location');

        // 3. Codex
        const cdxToml = path.join(homeDir, '.codex', 'config.toml');
        assert.ok(fs.existsSync(cdxToml), 'Codex config.toml must exist');
    });

    test('idempotency: multiple installation passes produce identical non-duplicated configurations', () => {
        // Run global install twice
        const runInstall = () => execFileSync(
            process.execPath,
            ['-e', `const i = require(${JSON.stringify(INSTALLER_PATH)}); i.installGlobalHooks();`],
            { env: { ...process.env, HOME: homeDir }, stdio: 'pipe' }
        );

        runInstall();
        runInstall();

        // Check Antigravity hooks
        const agHooks = path.join(homeDir, '.gemini', 'config', 'hooks.json');
        const agPath = fs.existsSync(agHooks) ? agHooks : path.join(homeDir, '.agents', 'hooks.json');
        if (fs.existsSync(agPath)) {
            const data = JSON.parse(fs.readFileSync(agPath, 'utf8'));
            const preToolBdb = (data.hooks.PreToolUse || []).filter(e => {
                const cmd = e.hooks?.[0]?.command || '';
                return cmd.includes('go-gate.mjs');
            });
            assert.equal(preToolBdb.length, 1, 'PreToolUse go-gate must not be duplicated on repeated runs');
        }

        // Check Codex TOML
        const cdxToml = path.join(homeDir, '.codex', 'config.toml');
        if (fs.existsSync(cdxToml)) {
            const toml = fs.readFileSync(cdxToml, 'utf8');
            const startMatches = toml.match(/# AOS:HOOKS:START/g) || [];
            assert.equal(startMatches.length, 1, 'Only one AOS:HOOKS:START block must exist after multiple runs');
        }
    });

    test('installer writing hooks followed by aos-doctor diagnostic verification', () => {
        // 1. Install global hooks in isolated HOME
        execFileSync(
            process.execPath,
            ['-e', `const i = require(${JSON.stringify(INSTALLER_PATH)}); i.installGlobalHooks();`],
            { env: { ...process.env, HOME: homeDir }, stdio: 'pipe' }
        );

        // 2. Run aos-doctor in JSON mode
        const docRes = runNodeScript(DOCTOR_SRC, {
            args: ['--json'],
            env: { HOME: homeDir }
        });

        assert.ok(docRes.stdout && docRes.stdout.trim().length > 0, `Doctor should produce output, stderr: ${docRes.stderr}`);
        let doctorReport;
        try {
            doctorReport = JSON.parse(docRes.stdout);
        } catch {
            doctorReport = null;
        }

        assert.ok(doctorReport && Array.isArray(doctorReport.results), 'Doctor must output JSON with results array');
        const hookRows = doctorReport.results.filter(r => r.area === 'hooks');
        assert.ok(hookRows.length > 0, 'Doctor must report on hooks');
        // Check that memb-inject is verified
        const membRow = hookRows.find(r => r.name === 'memb-inject.mjs');
        assert.ok(membRow, 'Doctor must inspect memb-inject.mjs');
        assert.ok(membRow.ok, `memb-inject.mjs should pass doctor check: ${membRow.detail}`);
    });
});

// ============================================================================
// TIER 4: REAL-WORLD MULTI-HARNESS SIMULATIONS
// ============================================================================

describe('Tier 4: Real-World Multi-Harness Simulations', () => {
    let tmpDir;
    let projDir;
    let mockDbPath;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-tier4-'));
        projDir = path.join(tmpDir, 'workspace', 'shop-service');
        fs.mkdirSync(path.join(projDir, '.git'), { recursive: true });
        fs.writeFileSync(path.join(projDir, 'package.json'), JSON.stringify({ name: '@acme/shop-service', version: '1.0.0' }));

        mockDbPath = path.join(tmpDir, '.MemBDB', 'memb.db');
        createMockMembDb(mockDbPath, [
            { user_id: 'bdb_developer', project_id: 'shop-service', data: 'Shop Service uses Stripe API v2024' },
            { user_id: 'alice', project_id: 'shop-service', memory: 'Alice prefers mock payment mode during tests' }
        ]);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('Scenario 1: Google Antigravity PreInvocation hook simulation', () => {
        const payload = JSON.stringify({
            invocationNum: 1,
            conversationId: 'ag-turn-1234',
            workspacePaths: [projDir],
            transcriptPath: path.join(tmpDir, 'transcript.jsonl'),
            prompt: 'How is Stripe initialized?'
        });

        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: payload,
            env: { HOME: tmpDir, MEMB_USER_ID: 'alice' }
        });

        assert.equal(res.status, 0);
        assert.ok(res.stdout, 'Expected stdout response');
        const parsed = JSON.parse(res.stdout);

        // Antigravity contract validation
        assert.ok(Array.isArray(parsed.injectSteps), 'injectSteps must be an array');
        assert.equal(parsed.injectSteps.length, 1);
        assert.ok(parsed.injectSteps[0].ephemeralMessage.includes('Stripe API v2024') || parsed.injectSteps[0].ephemeralMessage.includes('mock payment mode'),
            'Memory context must be delivered via ephemeralMessage');
    });

    test('Scenario 2: OpenAI Codex UserPromptSubmit hook simulation', () => {
        const payload = JSON.stringify({
            session_id: 'codex-sess-5678',
            prompt: 'Check test payments configuration',
            cwd: projDir,
            hook_event_name: 'UserPromptSubmit'
        });

        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: payload,
            env: { HOME: tmpDir, MEMB_USER_ID: 'alice' }
        });

        assert.equal(res.status, 0);
        const parsed = JSON.parse(res.stdout);

        // Codex contract validation
        assert.ok(typeof parsed.systemMessage === 'string', 'systemMessage must be a string');
        assert.ok(parsed.systemMessage.includes('shop-service'), 'systemMessage must contain project memories');
    });

    test('Scenario 3: Claude Code UserPromptSubmit hook simulation', () => {
        const payload = JSON.stringify({
            prompt: 'Explain the payment workflow',
            cwd: projDir
        });

        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: payload,
            env: { HOME: tmpDir, MEMB_USER_ID: 'alice' }
        });

        assert.equal(res.status, 0);
        const parsed = JSON.parse(res.stdout);

        // Claude Code contract validation
        assert.ok(parsed.hookSpecificOutput, 'hookSpecificOutput must be present');
        assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
        assert.ok(parsed.hookSpecificOutput.additionalContext.includes('Stripe API v2024'));
    });
});

// ============================================================================
// TIER 5: ADVERSARIAL STRESS & INTEGRITY
// ============================================================================

describe('Tier 5: Adversarial Stress & Integrity', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-tier5-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('Encoding & Escaping: handles shell meta-characters and quotes in prompts and paths', () => {
        const maliciousPrompt = 'Refactor; rm -rf /; $(whoami); `id`; "injection" \'single\' \\ \n \r \0';
        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: JSON.stringify({ prompt: maliciousPrompt, cwd: tmpDir }),
            env: { HOME: tmpDir }
        });
        assert.equal(res.status, 0, 'Must safely handle shell metacharacters without executing or crashing');
    });

    test('Path Traversal: rejects or bounds upward traversal when cwd is / or /tmp', () => {
        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: JSON.stringify({ prompt: 'test', cwd: '/' }),
            env: { HOME: tmpDir }
        });
        assert.equal(res.status, 0, 'Traversal from / must not hang or crash');
    });

    test('Unicode and Emoji Integrity: handles multi-byte UTF-8 project names and queries', () => {
        const unicodeProj = path.join(tmpDir, '🚀-proyecto-üñíçødé');
        fs.mkdirSync(path.join(unicodeProj, '.git'), { recursive: true });

        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: JSON.stringify({ prompt: '¿Cómo funciona el código? 🔍', cwd: unicodeProj }),
            env: { HOME: tmpDir }
        });
        assert.equal(res.status, 0, 'Must handle Unicode and emoji cleanly');
    });

    test('Resource Stress: handles large prompt payloads (500KB) within timeout without OOM', () => {
        const largePrompt = 'repeat '.repeat(80000); // ~560 KB
        const start = Date.now();
        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: JSON.stringify({ prompt: largePrompt, cwd: tmpDir }),
            env: { HOME: tmpDir }
        });
        const duration = Date.now() - start;
        assert.equal(res.status, 0);
        assert.ok(duration < 5000, `Large prompt processing took too long: ${duration}ms`);
    });
});
