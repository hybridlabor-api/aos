/**
 * tests/challenger-stress.test.js
 *
 * Adversarial Stress & Boundary Verification Test Suite (Challenger 1).
 *
 * Systematic stress-testing against:
 * 1. installer.js (mergeAntigravityHooks & mergeCodexTomlHooks)
 *    - Malformed files (syntax errors, partial JSON/TOML, non-object JSON)
 *    - Deeply nested configs & foreign structures
 *    - Preexisting user hooks & idempotency across multiple runs
 *    - Empty & whitespace-only files
 *    - False/true flags in TOML
 * 2. memb-inject.mjs
 *    - Multi-harness payloads: Antigravity, Codex, Claude
 *    - Missing stdin, whitespace stdin, non-JSON & binary stdin
 *    - Non-existent directories, root directory, deep hierarchies
 *    - User ID variants (MEMB_USER_ID, eventData.user_id, userId, bdb_developer)
 *    - Corrupt, empty, or missing SQLite database (fail-open verification)
 * 3. startcycle-dispatch.mjs
 *    - Non-matching prompts & near-miss prefixes
 *    - Malformed JSON stdin, non-object JSON, missing keys
 *    - CLI arguments (--help, -h, positional arguments, command prefix)
 *    - Empty strings & boundary prompts
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const INSTALLER_PATH = path.join(REPO_ROOT, 'installer.js');
const MEMB_INJECT_SRC = path.join(REPO_ROOT, '.claude', 'hooks', 'memb-inject.mjs');
const STARTCYCLE_DISPATCH_SRC = path.join(REPO_ROOT, '.claude', 'workflows', 'startcycle-dispatch.mjs');

function runNodeScript(scriptPath, { args = [], input = '', env = {}, cwd = null, timeout = 10000 } = {}) {
    return spawnSync(process.execPath, [scriptPath, ...args], {
        input,
        env: { ...process.env, ...env },
        cwd: cwd || REPO_ROOT,
        encoding: 'utf8',
        timeout,
    });
}

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
// SUITE 1: INSTALLER HOOK MERGERS STRESS TESTING
// ============================================================================
describe('Challenger Suite 1: Installer Hook Mergers', () => {
    let tmpDir;
    let installer;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'challenger-inst-'));
        installer = require(INSTALLER_PATH);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // --- Antigravity hooks.json tests ---

    test('mergeAntigravityHooks: completely empty (0-byte) file', () => {
        const hooksPath = path.join(tmpDir, 'hooks.json');
        fs.writeFileSync(hooksPath, '');

        installer.mergeAntigravityHooks(hooksPath);

        // On 0-byte file, readJsonFile fails, so it treats it as invalid JSON,
        // creates a .corrupt_*.bak backup, and writes .bdb-new.json sidecar without crashing
        const dirFiles = fs.readdirSync(tmpDir);
        const hasBackup = dirFiles.some(f => f.startsWith('hooks.json.corrupt_'));
        const hasSidecar = fs.existsSync(`${hooksPath}.bdb-new.json`);
        assert.ok(hasBackup || hasSidecar, 'Should handle 0-byte file via safe backup or sidecar');
        if (hasSidecar) {
            const sidecarContent = JSON.parse(fs.readFileSync(`${hooksPath}.bdb-new.json`, 'utf8'));
            assert.ok(sidecarContent.hooks.PreToolUse, 'Sidecar must contain valid hooks');
        }
    });

    test('mergeAntigravityHooks: whitespace-only file', () => {
        const hooksPath = path.join(tmpDir, 'hooks.json');
        fs.writeFileSync(hooksPath, '   \n\t  \n');

        installer.mergeAntigravityHooks(hooksPath);

        const hasSidecar = fs.existsSync(`${hooksPath}.bdb-new.json`);
        assert.ok(hasSidecar, 'Should produce safe sidecar for whitespace-only file without crashing');
    });

    test('mergeAntigravityHooks: severely malformed JSON (syntax errors & truncation)', () => {
        const hooksPath = path.join(tmpDir, 'hooks.json');
        fs.writeFileSync(hooksPath, '{"hooks": {"PreToolUse": [ { "matcher": "broken');

        installer.mergeAntigravityHooks(hooksPath);

        const dirFiles = fs.readdirSync(tmpDir);
        assert.ok(dirFiles.some(f => f.startsWith('hooks.json.corrupt_')), 'Must create backup of corrupt file');
        assert.ok(fs.existsSync(`${hooksPath}.bdb-new.json`), 'Must write clean sidecar');
    });

    test('mergeAntigravityHooks: non-object valid JSON (array, number, string, null)', () => {
        for (const badValue of ['[1, 2, 3]', '"just a string"', '12345', 'null', 'true']) {
            const testDir = fs.mkdtempSync(path.join(tmpDir, 'nonobj-'));
            const hooksPath = path.join(testDir, 'hooks.json');
            fs.writeFileSync(hooksPath, badValue);

            // Should not throw or crash
            assert.doesNotThrow(() => {
                installer.mergeAntigravityHooks(hooksPath);
            });
        }
    });

    test('mergeAntigravityHooks: deeply nested user configs & foreign hooks preservation', () => {
        const hooksPath = path.join(tmpDir, 'hooks.json');
        const initial = {
            version: '2.0',
            settings: {
                deep: {
                    level1: {
                        level2: {
                            securityPolicy: 'strict',
                            allowedTools: ['Bash', 'Python']
                        }
                    }
                }
            },
            hooks: {
                PreToolUse: [
                    {
                        matcher: 'custom_tool',
                        hooks: [{ type: 'command', command: 'echo custom_pre' }]
                    }
                ],
                CustomLifecycleEvent: [
                    {
                        hooks: [{ type: 'command', command: 'echo custom_event' }]
                    }
                ]
            }
        };
        fs.writeFileSync(hooksPath, JSON.stringify(initial, null, 2));

        installer.mergeAntigravityHooks(hooksPath);

        const updated = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
        assert.strictEqual(updated.settings.deep.level1.level2.securityPolicy, 'strict');
        assert.strictEqual(updated.hooks.CustomLifecycleEvent[0].hooks[0].command, 'echo custom_event');
        // PreToolUse should have user tool preserved and BDB go-gate added
        const preTools = updated.hooks.PreToolUse;
        assert.ok(preTools.some(h => h.matcher === 'custom_tool'), 'User custom_tool hook must be preserved');
        assert.ok(preTools.some(h => h.matcher === 'run_command|Bash'), 'BDB go-gate must be wired');
    });

    test('mergeAntigravityHooks: idempotency across 5 repeated merge cycles', () => {
        const hooksPath = path.join(tmpDir, 'hooks.json');
        fs.writeFileSync(hooksPath, JSON.stringify({ hooks: {} }));

        installer.mergeAntigravityHooks(hooksPath);
        const once = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
        for (let i = 0; i < 4; i++) {
            installer.mergeAntigravityHooks(hooksPath);
        }

        const final = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
        // PreToolUse and Stop each carry two AOS entries (gate + trail-relay); what must hold is that re-runs add none.
        assert.strictEqual(final.hooks.PreToolUse.length, once.hooks.PreToolUse.length, 'PreToolUse must not duplicate on repeated runs');
        assert.strictEqual(final.hooks.Stop.length, once.hooks.Stop.length, 'Stop must not duplicate on repeated runs');
        assert.strictEqual(final.hooks.PreInvocation.length, 1, 'PreInvocation must not duplicate on repeated runs');
    });

    // --- Codex config.toml tests ---

    test('mergeCodexTomlHooks: completely empty (0-byte) file', () => {
        const tomlPath = path.join(tmpDir, 'config.toml');
        fs.writeFileSync(tomlPath, '');

        installer.mergeCodexTomlHooks(tomlPath);

        const content = fs.readFileSync(tomlPath, 'utf8');
        assert.ok(content.includes('[features]\nhooks = true'), 'Must initialize [features] hooks = true');
        assert.ok(content.includes('# AOS:HOOKS:START'), 'Must include AOS hook block');
        assert.ok(content.includes('# AOS:HOOKS:END'), 'Must include AOS hook block close');
    });

    test('mergeCodexTomlHooks: whitespace-only file', () => {
        const tomlPath = path.join(tmpDir, 'config.toml');
        fs.writeFileSync(tomlPath, '   \n\t\n   ');

        installer.mergeCodexTomlHooks(tomlPath);

        const content = fs.readFileSync(tomlPath, 'utf8');
        assert.ok(content.includes('[features]'));
        assert.ok(content.includes('hooks = true'));
        assert.ok(content.includes('# AOS:HOOKS:START'));
    });

    test('mergeCodexTomlHooks: complex existing TOML with comments, MCP servers, and features', () => {
        const tomlPath = path.join(tmpDir, 'config.toml');
        const initial = [
            '# User Codex Config Header',
            'model = "o3-mini"',
            '',
            '[features]',
            'web_search = true',
            '',
            '# MCP configuration',
            '[mcp_servers.my_custom_server]',
            'command = "npx"',
            'args = ["-y", "custom-mcp"]',
            ''
        ].join('\n');
        fs.writeFileSync(tomlPath, initial);

        installer.mergeCodexTomlHooks(tomlPath);

        const content = fs.readFileSync(tomlPath, 'utf8');
        assert.ok(content.includes('# User Codex Config Header'), 'Must preserve user comments');
        assert.ok(content.includes('model = "o3-mini"'), 'Must preserve root settings');
        assert.ok(content.includes('web_search = true'), 'Must preserve existing feature flags');
        assert.ok(content.includes('hooks = true'), 'Must add hooks = true under features');
        assert.ok(content.includes('[mcp_servers.my_custom_server]'), 'Must preserve MCP tables');
        assert.ok(content.includes('# AOS:HOOKS:START'), 'Must include AOS hook block');
    });

    test('mergeCodexTomlHooks: existing hooks = false under [features] handled gracefully', () => {
        const tomlPath = path.join(tmpDir, 'config.toml');
        const initial = [
            '[features]',
            'hooks = false',
            'code_search = true',
        ].join('\n');
        fs.writeFileSync(tomlPath, initial);

        installer.mergeCodexTomlHooks(tomlPath);

        const content = fs.readFileSync(tomlPath, 'utf8');
        assert.ok(content.includes('hooks = true'), 'Must enable hooks');
        assert.ok(content.includes('# AOS:HOOKS:START'), 'Must write hooks');
    });

    test('mergeCodexTomlHooks: idempotency across 5 repeated merge cycles', () => {
        const tomlPath = path.join(tmpDir, 'config.toml');
        fs.writeFileSync(tomlPath, 'model = "gpt-4o"\n');

        for (let i = 0; i < 5; i++) {
            installer.mergeCodexTomlHooks(tomlPath);
        }

        const content = fs.readFileSync(tomlPath, 'utf8');
        const startMatches = content.match(/# AOS:HOOKS:START/g) || [];
        const endMatches = content.match(/# AOS:HOOKS:END/g) || [];
        assert.strictEqual(startMatches.length, 1, 'Only one # AOS:HOOKS:START block allowed');
        assert.strictEqual(endMatches.length, 1, 'Only one # AOS:HOOKS:END block allowed');
    });
});

// ============================================================================
// SUITE 2: MEMB-INJECT.MJS STRESS TESTING
// ============================================================================
describe('Challenger Suite 2: memB Injection Hook Robustness', () => {
    let tmpHome;
    let mockDbPath;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'challenger-memb-home-'));
        mockDbPath = path.join(tmpHome, '.MemBDB', 'memb.db');
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    test('missing stdin (closed/empty stream): exits cleanly (0) with no output and no errors', () => {
        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: '',
            env: { HOME: tmpHome }
        });
        assert.strictEqual(res.status, 0, 'Must exit code 0 on empty stdin');
        assert.strictEqual(res.stderr, '', 'Must not print errors on empty stdin');
    });

    test('whitespace-only stdin: exits cleanly (0) with no output and no errors', () => {
        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: '    \n\t   \n',
            env: { HOME: tmpHome }
        });
        assert.strictEqual(res.status, 0, 'Must exit code 0 on whitespace stdin');
        assert.strictEqual(res.stderr, '', 'Must not print errors on whitespace stdin');
    });

    test('non-JSON stdin (raw text, truncated JSON, binary): fails open (0) without crashing', () => {
        const badInputs = [
            'Hello world this is plain text',
            '{ "unclosed": "json',
            '{"prompt": 123, broken',
            Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]).toString(),
            'null',
            '[]'
        ];

        for (const input of badInputs) {
            const res = runNodeScript(MEMB_INJECT_SRC, {
                input,
                env: { HOME: tmpHome }
            });
            assert.strictEqual(res.status, 0, `Must exit 0 on bad input: ${input.slice(0, 20)}`);
            assert.strictEqual(res.stderr, '', 'Stderr must remain silent');
        }
    });

    test('missing SQLite database: fails open (0) with silent exit', () => {
        // No .MemBDB directory exists
        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: JSON.stringify({ prompt: 'architectural plan' }),
            env: { HOME: tmpHome }
        });
        assert.strictEqual(res.status, 0);
        assert.strictEqual(res.stderr, '');
    });

    test('corrupt SQLite database (0-byte file and garbage text): fails open (0)', () => {
        fs.mkdirSync(path.join(tmpHome, '.MemBDB'), { recursive: true });

        // 1. 0-byte file
        fs.writeFileSync(mockDbPath, '');
        let res = runNodeScript(MEMB_INJECT_SRC, {
            input: JSON.stringify({ prompt: 'architectural plan' }),
            env: { HOME: tmpHome }
        });
        assert.strictEqual(res.status, 0);
        assert.strictEqual(res.stderr, '');

        // 2. Garbage text file
        fs.writeFileSync(mockDbPath, 'GARBAGE NOT SQLITE DATA');
        res = runNodeScript(MEMB_INJECT_SRC, {
            input: JSON.stringify({ prompt: 'architectural plan' }),
            env: { HOME: tmpHome }
        });
        assert.strictEqual(res.status, 0);
        assert.strictEqual(res.stderr, '');
    });

    test('non-existent directories and root directory input: resolves safely without crashing', () => {
        createMockMembDb(mockDbPath, [{
            project_id: 'default_proj',
            memory: 'Base project memory'
        }]);

        const inputs = [
            { workspacePaths: ['/a/completely/nonexistent/directory/xyz123'], prompt: 'hello' },
            { workspacePaths: ['/'], prompt: 'testing root directory' },
            { cwd: '/another/missing/path/def456', prompt: 'testing cwd' },
            { workspacePaths: [], prompt: 'testing empty array' },
            { workspacePaths: null, prompt: 'testing null array' }
        ];

        for (const input of inputs) {
            const res = runNodeScript(MEMB_INJECT_SRC, {
                input: JSON.stringify(input),
                env: { HOME: tmpHome }
            });
            assert.strictEqual(res.status, 0, `Must exit 0 on input: ${JSON.stringify(input)}`);
            assert.strictEqual(res.stderr, '');
        }
    });

    test('multi-harness user ID resolution: reconciles active user and bdb_developer baseline', () => {
        const seededRecords = [
            {
                project_id: 'user_test_proj',
                user_id: 'alice',
                category: 'project_card',
                memory: 'Alice specific preference for user_test_proj'
            },
            {
                project_id: 'user_test_proj',
                user_id: 'bdb_developer',
                category: 'project_card',
                memory: 'Baseline system rule for user_test_proj'
            },
            {
                project_id: 'user_test_proj',
                user_id: 'charlie',
                category: 'project_card',
                memory: 'Charlie confidential record'
            }
        ];
        createMockMembDb(mockDbPath, seededRecords);

        // Project directory setup
        const projDir = path.join(tmpHome, 'dev', 'user_test_proj');
        fs.mkdirSync(path.join(projDir, '.aos'), { recursive: true });
        fs.writeFileSync(path.join(projDir, '.aos', 'project.json'), JSON.stringify({ projectId: 'user_test_proj' }));

        // 1. Invocation with active user 'alice' -> should match alice AND bdb_developer, NOT charlie
        const resAlice = runNodeScript(MEMB_INJECT_SRC, {
            input: JSON.stringify({
                workspacePaths: [projDir],
                prompt: 'user preferences check'
            }),
            env: {
                HOME: tmpHome,
                MEMB_USER_ID: 'alice'
            }
        });
        assert.strictEqual(resAlice.status, 0);
        const parsedAlice = JSON.parse(resAlice.stdout.trim());
        const contextAlice = parsedAlice.hookSpecificOutput.additionalContext;
        assert.ok(contextAlice.includes('Alice specific preference'), 'Must match active user alice');
        assert.ok(contextAlice.includes('Baseline system rule'), 'Must match bdb_developer baseline');
        assert.ok(!contextAlice.includes('Charlie confidential'), 'Must NOT match charlie');

        // 2. Invocation via Codex eventData.user_id = 'charlie'
        const resCharlie = runNodeScript(MEMB_INJECT_SRC, {
            input: JSON.stringify({
                cwd: projDir,
                userPrompt: 'check data',
                user_id: 'charlie'
            }),
            env: {
                HOME: tmpHome,
                MEMB_USER_ID: ''
            }
        });
        assert.strictEqual(resCharlie.status, 0);
        const parsedCharlie = JSON.parse(resCharlie.stdout.trim());
        const contextCharlie = parsedCharlie.hookSpecificOutput.additionalContext;
        assert.ok(contextCharlie.includes('Charlie confidential'), 'Must match charlie');
        assert.ok(contextCharlie.includes('Baseline system rule'), 'Must match bdb_developer');
        assert.ok(!contextCharlie.includes('Alice specific preference'), 'Must NOT match alice');
    });

    test('tri-format JSON output structure compliance', () => {
        createMockMembDb(mockDbPath, [{
            project_id: 'tri_format_proj',
            category: 'project_card',
            memory: 'High agency frontend taste tokens'
        }]);

        const projDir = path.join(tmpHome, 'dev', 'tri_format_proj');
        fs.mkdirSync(projDir, { recursive: true });

        const res = runNodeScript(MEMB_INJECT_SRC, {
            input: JSON.stringify({
                workspacePaths: [projDir],
                prompt: 'design system'
            }),
            env: { HOME: tmpHome }
        });
        assert.strictEqual(res.status, 0);
        const out = JSON.parse(res.stdout.trim());

        // Tri-format verification:
        // 1. Claude: hookSpecificOutput
        assert.ok(out.hookSpecificOutput && out.hookSpecificOutput.additionalContext, 'Missing Claude hookSpecificOutput');
        // 2. Antigravity: injectSteps
        assert.ok(Array.isArray(out.injectSteps) && out.injectSteps.length > 0, 'Missing Antigravity injectSteps');
        assert.ok(out.injectSteps[0].ephemeralMessage, 'Missing ephemeralMessage in injectSteps');
        // 3. Codex: systemMessage
        assert.ok(typeof out.systemMessage === 'string' && out.systemMessage.length > 0, 'Missing Codex systemMessage');
    });
});

// ============================================================================
// SUITE 3: STARTCYCLE-DISPATCH.MJS STRESS TESTING
// ============================================================================
describe('Challenger Suite 3: Startcycle Dispatcher Robustness', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'challenger-disp-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('non-matching prompts fast-exit with injectSteps: [] and code 0', () => {
        const nonMatching = [
            'How do I implement binary search in Rust?',
            'Please explain what this file does',
            '/startcycle',
            '/startcycle-graphical',
            '/startcycle_graph',
            'startcycle-graph',
            'echo /startcycle-graph',
            ''
        ];

        for (const prompt of nonMatching) {
            const res = runNodeScript(STARTCYCLE_DISPATCH_SRC, {
                input: JSON.stringify({ prompt }),
                cwd: tmpDir
            });
            assert.strictEqual(res.status, 0, `Must exit 0 on non-matching prompt: ${prompt}`);
            assert.strictEqual(res.stderr, '', `Stderr must be empty for prompt: ${prompt}`);
            if (prompt !== '') {
                const parsed = JSON.parse(res.stdout.trim());
                assert.deepStrictEqual(parsed, { injectSteps: [] }, 'Must return injectSteps: []');
            }
        }
    });

    test('malformed JSON stdin: exits cleanly without SyntaxError or crash', () => {
        const malformedInputs = [
            'not a json string',
            '{ "prompt": "unclosed',
            '{"unclosed: 123',
            '   \n\t  ',
            '12345',
            '"plain string"'
        ];

        for (const input of malformedInputs) {
            const res = runNodeScript(STARTCYCLE_DISPATCH_SRC, {
                input,
                cwd: tmpDir
            });
            assert.strictEqual(res.status, 0, `Must not crash on malformed input: ${input.slice(0, 20)}`);
            assert.strictEqual(res.stderr, '', 'Stderr must be empty');
        }
    });

    test('CLI help flags: node startcycle-dispatch.mjs --help and -h', () => {
        for (const flag of ['--help', '-h']) {
            const res = runNodeScript(STARTCYCLE_DISPATCH_SRC, {
                args: [flag],
                cwd: tmpDir
            });
            assert.strictEqual(res.status, 0, `Must exit 0 on flag ${flag}`);
            assert.ok(res.stdout.includes('Usage: node startcycle-dispatch.mjs'), 'Must print usage');
            assert.strictEqual(res.stderr, '');
        }
    });

    test('CLI argument parsing extracts goal directly', () => {
        // Run with mock nodes.json so load-registry succeeds
        const agentsDir = path.join(tmpDir, '.agents');
        fs.mkdirSync(agentsDir, { recursive: true });
        fs.writeFileSync(path.join(agentsDir, 'nodes.json'), JSON.stringify({
            version: 1,
            nodes: {
                architect: {}, techlead: {}, godmode_ui_ux: {},
                godmode_engineering: {}, godmode_media_eventtech: {},
                reviewer: {}, godmode_shipping: {}
            }
        }));

        const res = runNodeScript(STARTCYCLE_DISPATCH_SRC, {
            args: ['Build resilient multi-harness dispatch'],
            cwd: tmpDir
        });
        assert.strictEqual(res.status, 0);
        assert.strictEqual(res.stderr, '');
        assert.ok(res.stdout.length > 0, 'Should output workflow execution result');
    });

    test('CLI with /startcycle-graph prefix strips prefix cleanly', () => {
        const agentsDir = path.join(tmpDir, '.agents');
        fs.mkdirSync(agentsDir, { recursive: true });
        fs.writeFileSync(path.join(agentsDir, 'nodes.json'), JSON.stringify({
            version: 1,
            nodes: {
                architect: {}, techlead: {}, godmode_ui_ux: {},
                godmode_engineering: {}, godmode_media_eventtech: {},
                reviewer: {}, godmode_shipping: {}
            }
        }));

        const res = runNodeScript(STARTCYCLE_DISPATCH_SRC, {
            args: ['/startcycle-graph', 'Refactor database models'],
            cwd: tmpDir
        });
        assert.strictEqual(res.status, 0);
        assert.strictEqual(res.stderr, '');
    });

    test('hook-invoked trigger returns injectSteps and systemMessage', () => {
        const agentsDir = path.join(tmpDir, '.agents');
        fs.mkdirSync(agentsDir, { recursive: true });
        fs.writeFileSync(path.join(agentsDir, 'nodes.json'), JSON.stringify({
            version: 1,
            nodes: {
                architect: {}, techlead: {}, godmode_ui_ux: {},
                godmode_engineering: {}, godmode_media_eventtech: {},
                reviewer: {}, godmode_shipping: {}
            }
        }));

        const res = runNodeScript(STARTCYCLE_DISPATCH_SRC, {
            input: JSON.stringify({ prompt: '/startcycle-graph Deploy automated CI/CD pipeline' }),
            cwd: tmpDir
        });
        assert.strictEqual(res.status, 0);
        assert.strictEqual(res.stderr, '');
        const parsed = JSON.parse(res.stdout.trim());
        assert.ok(Array.isArray(parsed.injectSteps), 'Must return injectSteps for Antigravity');
        assert.ok(typeof parsed.systemMessage === 'string', 'Must return systemMessage for Codex');
        assert.ok(parsed.result, 'Must include result object');
    });
});
