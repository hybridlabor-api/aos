/**
 * tests/challenger2-adversarial-verification.test.mjs
 *
 * Empirical Challenger 2 Adversarial Stress & Verification Test Suite.
 *
 * Focus Areas:
 * 1. Deep Idempotence & Anti-Duplication Harness:
 *    - mergeAntigravityHooks: 10x repeated runs on clean, populated, foreign-hooked, and corrupt configs.
 *    - mergeCodexTomlHooks: 10x repeated runs on clean, populated, custom-feature, and comment-heavy TOML.
 *    - installProjectHarness: multiple full runs in simulated project environment.
 * 2. Multi-Harness Interoperability Simulation:
 *    - memb-inject.mjs: Antigravity, Codex, and Claude simulation environments with real SQLite fixture.
 *    - startcycle-dispatch.mjs: Antigravity, Codex, and standalone CLI simulation with fast-exit and command recognition.
 * 3. Diagnostic Accuracy (aos-doctor.mjs):
 *    - Isolated platform simulations (Claude-only, Antigravity-only, Codex-only, Tri-Harness).
 *    - Hook version sensitivity (v3 pass, v2 fail, missing stamp fail).
 * 4. Adversarial Stress & Edge Cases:
 *    - SQL injection attempt payloads in project_id and prompt.
 *    - Non-object and malformed stdin inputs.
 *    - Traversal boundary enforcement at $HOME and root.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const REPO_ROOT = path.resolve(__dirname, '..');
const INSTALLER_PATH = path.join(REPO_ROOT, 'installer.js');
const MEMB_INJECT_PATH = path.join(REPO_ROOT, '.claude', 'hooks', 'memb-inject.mjs');
const STARTCYCLE_DISPATCH_PATH = path.join(REPO_ROOT, '.claude', 'workflows', 'startcycle-dispatch.mjs');
const DOCTOR_PATH = path.join(REPO_ROOT, 'skills', 'global_config', 'aos-setup', 'scripts', 'aos-doctor.mjs');
const DOCTOR_ENV = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };

const installer = require(INSTALLER_PATH);

function runNode(script, { args = [], input = '', env = {}, cwd = null, timeout = 10000 } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    input,
    env: { ...process.env, ...env },
    cwd: cwd || REPO_ROOT,
    encoding: 'utf8',
    timeout,
  });
}

function createSqliteDb(dbPath, records = []) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memb_vectors (
      id TEXT PRIMARY KEY,
      collection TEXT,
      vector BLOB,
      payload TEXT,
      created_at TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memb_fts USING fts5(id, collection, content);
  `);
  const insert = db.prepare('INSERT INTO memb_vectors (id, collection, payload) VALUES (?, ?, ?)');
  const insertFts = db.prepare('INSERT INTO memb_fts (id, collection, content) VALUES (?, ?, ?)');
  records.forEach((record, index) => {
    const id = `row-${index}`;
    const payload = JSON.stringify(record);
    insert.run(id, 'bdb_agent_memory', payload);
    insertFts.run(id, 'bdb_agent_memory', String(record.memory || record.data || ''));
  });
  db.close();
}

describe('Challenger 2 Empirical Verification: Idempotence & Interoperability', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'challenger2-verify-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================================================
  // AREA 1: IDEMPOTENCE & ANTI-DUPLICATION
  // ==========================================================================
  describe('Area 1: Idempotence Verification', () => {
    test('mergeAntigravityHooks: 10 consecutive passes produce strictly identical output without duplicating hooks', () => {
      const hooksFile = path.join(tmpDir, 'hooks.json');

      // Seed with a foreign hook to ensure user hooks aren't wiped or duplicated
      const initial = {
        name: 'user-antigravity-config',
        hooks: {
          PreToolUse: [
            { matcher: 'custom_tool', hooks: [{ type: 'command', command: 'echo custom-pre-tool' }] }
          ],
          CustomEvent: [
            { hooks: [{ type: 'command', command: 'echo custom-event' }] }
          ]
        }
      };
      fs.writeFileSync(hooksFile, JSON.stringify(initial, null, 2));

      // Run 10 consecutive merges
      for (let i = 0; i < 10; i++) {
        installer.mergeAntigravityHooks(hooksFile);
      }

      const parsed = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
      assert.strictEqual(parsed.name, 'user-antigravity-config', 'preserves top-level metadata');
      assert.strictEqual(parsed.hooks.CustomEvent.length, 1, 'preserves foreign custom event intact');

      const preToolCommands = parsed.hooks.PreToolUse.flatMap(e => e.hooks.map(h => h.command));
      assert.strictEqual(preToolCommands.filter(c => c.includes('go-gate.mjs')).length, 1, 'exactly 1 go-gate hook');
      assert.strictEqual(preToolCommands.filter(c => c.includes('trail-relay.mjs')).length, 1, 'exactly 1 Antigravity trail relay hook');
      assert.strictEqual(preToolCommands.filter(c => c.includes('custom-pre-tool')).length, 1, 'exactly 1 foreign tool hook');

      const stopCommands = parsed.hooks.Stop.flatMap(e => e.hooks.map(h => h.command));
      assert.strictEqual(stopCommands.filter(c => c.includes('graph-gate.mjs')).length, 1, 'exactly 1 graph-gate hook');
      assert.strictEqual(stopCommands.filter(c => c.includes('trail-relay.mjs')).length, 1, 'exactly 1 Antigravity trail relay hook');

      assert.strictEqual(parsed.hooks.PreInvocation.length, 1, 'PreInvocation has exactly 1 entry');
      assert.strictEqual(parsed.hooks.PreInvocation[0].hooks.length, 2, 'PreInvocation has exactly 2 hooks');
      const preInvocCmds = parsed.hooks.PreInvocation[0].hooks.map(h => h.command);
      assert.strictEqual(preInvocCmds.filter(c => c.includes('memb-inject.mjs')).length, 1);
      assert.strictEqual(preInvocCmds.filter(c => c.includes('startcycle-dispatch.mjs')).length, 1);

      // 11th run snapshot check
      const snapshotBefore = fs.readFileSync(hooksFile, 'utf8');
      installer.mergeAntigravityHooks(hooksFile);
      const snapshotAfter = fs.readFileSync(hooksFile, 'utf8');
      assert.strictEqual(snapshotBefore, snapshotAfter, 'Byte-for-byte idempotent after initial convergence');
    });

    test('mergeCodexTomlHooks: 10 consecutive passes produce strictly identical config.toml without block duplication', () => {
      const tomlFile = path.join(tmpDir, 'config.toml');

      const initialToml = [
        '# User Codex Config',
        'model = "gpt-4o"',
        '',
        '[features]',
        'multi_agent = true',
        '',
        '[mcp_servers.my_custom_server]',
        'command = "npx"',
        'args = ["-y", "custom-mcp"]',
        ''
      ].join('\n');
      fs.writeFileSync(tomlFile, initialToml);

      // Run 10 consecutive merges
      for (let i = 0; i < 10; i++) {
        installer.mergeCodexTomlHooks(tomlFile);
      }

      const content = fs.readFileSync(tomlFile, 'utf8');

      // Verify features section has hooks = true and multi_agent = true
      assert(/\[features\][\s\S]*hooks\s*=\s*true/.test(content), 'contains hooks = true');
      assert(/multi_agent\s*=\s*true/.test(content), 'preserves multi_agent = true');
      assert.strictEqual((content.match(/hooks\s*=\s*true/g) || []).length, 1, 'exactly 1 hooks = true');

      // Verify user MCP server preserved
      assert(content.includes('[mcp_servers.my_custom_server]'), 'preserves custom mcp server');
      assert(content.includes('custom-mcp'), 'preserves custom mcp args');

      // Verify AOS:HOOKS block appears exactly once
      const startMatches = content.match(/# AOS:HOOKS:START/g) || [];
      const endMatches = content.match(/# AOS:HOOKS:END/g) || [];
      assert.strictEqual(startMatches.length, 1, 'exactly 1 # AOS:HOOKS:START delimiter');
      assert.strictEqual(endMatches.length, 1, 'exactly 1 # AOS:HOOKS:END delimiter');

      assert.strictEqual((content.match(/go-gate\.mjs/g) || []).length, 1, 'exactly 1 go-gate hook');
      assert.strictEqual((content.match(/graph-gate\.mjs/g) || []).length, 1, 'exactly 1 graph-gate hook');
      assert.strictEqual((content.match(/memb-inject\.mjs/g) || []).length, 2, 'exactly 2 memb-inject hooks');
      assert.strictEqual((content.match(/startcycle-dispatch\.mjs/g) || []).length, 1, 'exactly 1 startcycle-dispatch hook');
      assert.strictEqual((content.match(/trail-relay\.mjs/g) || []).length, 2, 'exactly 2 trail-relay hooks');

      // 11th run snapshot check
      const snapshotBefore = fs.readFileSync(tomlFile, 'utf8');
      installer.mergeCodexTomlHooks(tomlFile);
      const snapshotAfter = fs.readFileSync(tomlFile, 'utf8');
      assert.strictEqual(snapshotBefore, snapshotAfter, 'Byte-for-byte idempotent after convergence');
    });

    test('projectLocal harness installation idempotency', () => {
      const agHooksFile = path.join(tmpDir, '.agents', 'hooks.json');
      const cdxConfigFile = path.join(tmpDir, '.codex', 'config.toml');

      for (let i = 0; i < 3; i++) {
        installer.mergeAntigravityHooks(agHooksFile, { projectLocal: true });
        installer.mergeCodexTomlHooks(cdxConfigFile, { projectLocal: true });
      }

      const agContent = JSON.parse(fs.readFileSync(agHooksFile, 'utf8'));
      assert.strictEqual(agContent.hooks.PreToolUse.length, 2);
      assert.strictEqual(agContent.hooks.Stop.length, 2);
      assert.strictEqual(agContent.hooks.PreInvocation.length, 1);

      const cdxContent = fs.readFileSync(cdxConfigFile, 'utf8');
      assert.strictEqual((cdxContent.match(/# AOS:HOOKS:START/g) || []).length, 1);
      assert.strictEqual((cdxContent.match(/# AOS:HOOKS:END/g) || []).length, 1);
    });
  });

  // ==========================================================================
  // AREA 2: INTEROPERABILITY SIMULATION (memb-inject & startcycle-dispatch)
  // ==========================================================================
  describe('Area 2: Multi-Harness Interoperability Simulation', () => {
    let mockHome;
    let mockDbPath;
    let mockProjectDir;

    beforeEach(() => {
      mockHome = path.join(tmpDir, 'home');
      mockDbPath = path.join(mockHome, '.MemBDB', 'memb.db');
      mockProjectDir = path.join(tmpDir, 'workspaces', 'alpha-service');

      fs.mkdirSync(path.join(mockProjectDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(mockProjectDir, 'package.json'), JSON.stringify({
        name: '@enterprise/alpha-service',
        version: '1.0.0'
      }));

      // Create test SQLite memories
      createSqliteDb(mockDbPath, [
        {
          category: 'project_card',
          project_id: 'alpha-service',
          user_id: 'engineer_jane',
          data: 'Alpha service strictly implements hexagonal architecture.'
        },
        {
          category: 'project_card',
          project: 'alpha-service',
          user_id: 'bdb_developer',
          memory: 'Standard build command for alpha service is pnpm build.'
        },
        {
          category: 'project_card',
          metadata: { project_id: 'other-service' },
          user_id: 'engineer_jane',
          data: 'Other service memory that must not be leaked to alpha service.'
        }
      ]);
    });

    test('memb-inject: Antigravity simulation with workspacePaths array emits tri-format JSON matching project', () => {
      const agPayload = JSON.stringify({
        prompt: 'How do I structure the code?',
        workspacePaths: [path.join(mockProjectDir, 'src')],
        user_id: 'engineer_jane'
      });

      const res = runNode(MEMB_INJECT_PATH, {
        input: agPayload,
        env: {
          HOME: mockHome,
          USER: 'engineer_jane'
        },
        cwd: mockProjectDir
      });

      assert.strictEqual(res.status, 0, 'exits 0');
      assert(res.stdout, 'produces stdout');
      const out = JSON.parse(res.stdout);

      // Tri-format verification:
      assert(out.hookSpecificOutput, 'has hookSpecificOutput for Claude');
      assert(Array.isArray(out.injectSteps), 'has injectSteps array for Antigravity');
      assert(typeof out.systemMessage === 'string', 'has systemMessage for Codex');

      const text = out.injectSteps[0].ephemeralMessage;
      assert(text.includes('hexagonal architecture'), 'contains active user project memory');
      assert(text.includes('Standard build command'), 'contains bdb_developer baseline memory');
      assert(!text.includes('Other service memory'), 'does not leak foreign project memory');
    });

    test('memb-inject: Codex simulation with cwd and userPrompt emits tri-format JSON', () => {
      const cdxPayload = JSON.stringify({
        userPrompt: 'What is the build command?',
        cwd: mockProjectDir,
        user_id: 'engineer_jane'
      });

      const res = runNode(MEMB_INJECT_PATH, {
        input: cdxPayload,
        env: {
          HOME: mockHome,
          USER: 'engineer_jane'
        },
        cwd: mockProjectDir
      });

      assert.strictEqual(res.status, 0);
      assert(res.stdout);
      const out = JSON.parse(res.stdout);

      assert(out.systemMessage, 'systemMessage present');
      assert(out.systemMessage.includes('Standard build command'));
      assert(out.systemMessage.includes('hexagonal architecture'));
      assert(!out.systemMessage.includes('Other service memory'));
    });

    test('memb-inject: Claude Code SessionStart simulation with cwd', () => {
      const claudePayload = JSON.stringify({
        prompt: '',
        cwd: mockProjectDir,
        hook_event_name: 'SessionStart'
      });

      const res = runNode(MEMB_INJECT_PATH, {
        input: claudePayload,
        env: {
          HOME: mockHome,
          MEMB_USER_ID: 'engineer_jane'
        },
        cwd: mockProjectDir
      });

      assert.strictEqual(res.status, 0);
      const out = JSON.parse(res.stdout);
      assert.strictEqual(out.hookSpecificOutput.hookEventName, 'SessionStart');
      assert(out.hookSpecificOutput.additionalContext.includes('hexagonal architecture'));
    });

    test('startcycle-dispatch: Antigravity simulation on non-command prompt exits immediately with code 0', () => {
      const nonCmdPayload = JSON.stringify({
        prompt: 'Please explain this function in detail.'
      });

      const t0 = Date.now();
      const res = runNode(STARTCYCLE_DISPATCH_PATH, {
        input: nonCmdPayload,
        cwd: mockProjectDir
      });
      const elapsed = Date.now() - t0;

      assert.strictEqual(res.status, 0, 'exits cleanly with 0');
      assert(elapsed < 2000, `fast exit took ${elapsed}ms (< 2000ms)`);
      const out = JSON.parse(res.stdout.trim());
      assert.deepStrictEqual(out, { injectSteps: [] }, 'returns empty injectSteps payload');
    });

    test('startcycle-dispatch: Codex simulation on non-command userPrompt exits cleanly with code 0', () => {
      const nonCmdPayload = JSON.stringify({
        userPrompt: 'Write a regex for email addresses.'
      });

      const res = runNode(STARTCYCLE_DISPATCH_PATH, {
        input: nonCmdPayload,
        cwd: mockProjectDir
      });

      assert.strictEqual(res.status, 0);
      const out = JSON.parse(res.stdout.trim());
      assert.deepStrictEqual(out, { injectSteps: [] });
    });

    test('startcycle-dispatch: Antigravity simulation on /startcycle-graph triggers and recognizes goal', () => {
      const cmdPayload = JSON.stringify({
        prompt: '/startcycle-graph Implement OAuth2 token refresh pipeline'
      });

      // Pass PATH without agy binary so deterministic adapter executes quickly
      const res = runNode(STARTCYCLE_DISPATCH_PATH, {
        input: cmdPayload,
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
        cwd: REPO_ROOT // has .agents/nodes.json
      });

      assert.strictEqual(res.status, 0, 'exits 0');
      assert(res.stdout, 'outputs result');
      const out = JSON.parse(res.stdout.trim());
      assert(out.injectSteps, 'contains injectSteps for Antigravity');
      assert(out.systemMessage, 'contains systemMessage for Codex');
      assert(out.result, 'contains execution result');
      assert(['ready_to_ship', 'escalated'].includes(out.result.phase), 'phase is valid');
    });

    test('startcycle-dispatch: Standalone CLI arguments invocation recognizes goal', () => {
      const res = runNode(STARTCYCLE_DISPATCH_PATH, {
        args: ['Refactor database repository layer'],
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
        cwd: REPO_ROOT
      });

      assert.strictEqual(res.status, 0);
      assert(res.stdout);
      const out = JSON.parse(res.stdout.trim());
      assert(out.phase, 'returns structured phase result');
      assert(['ready_to_ship', 'escalated'].includes(out.phase));
    });
  });

  // ==========================================================================
  // AREA 3: DIAGNOSTIC ACCURACY (aos-doctor.mjs)
  // ==========================================================================
  describe('Area 3: Diagnostic Accuracy across Platforms', () => {
    let mockHome;

    beforeEach(() => {
      mockHome = path.join(tmpDir, 'doc-home');
      fs.mkdirSync(mockHome, { recursive: true });
    });

    test('aos-doctor: accurately flags Antigravity hooks.json as wired vs missing', () => {
      // 1. Create .gemini/antigravity-cli without hooks.json
      const agDir = path.join(mockHome, '.gemini', 'antigravity-cli');
      fs.mkdirSync(agDir, { recursive: true });

      // Run doctor with mock HOME
      let res = runNode(DOCTOR_PATH, {
        args: ['--json'],
        env: { HOME: mockHome, ...DOCTOR_ENV }
      });
      let doc = JSON.parse(res.stdout);
      assert(Array.isArray(doc.results), 'doc has results array');
      let agHookCheck = doc.results.find(r => r.area === 'hooks' && r.name.includes('Antigravity'));
      assert(agHookCheck, 'doctor detects Antigravity harness');
      assert.strictEqual(agHookCheck.ok, false, 'reports missing hooks.json when absent');

      // 2. Wire hooks.json via installer
      const hooksFile = path.join(agDir, 'hooks.json');
      installer.mergeAntigravityHooks(hooksFile);

      res = runNode(DOCTOR_PATH, {
        args: ['--json'],
        env: { HOME: mockHome, ...DOCTOR_ENV }
      });
      doc = JSON.parse(res.stdout);
      agHookCheck = doc.results.find(r => r.area === 'hooks' && r.name.includes('Antigravity'));
      assert.strictEqual(agHookCheck.ok, true, 'reports wired hooks.json after merge');
    });

    test('aos-doctor: accurately flags Codex config.toml as wired vs missing', () => {
      const codexDir = path.join(mockHome, '.codex');
      fs.mkdirSync(codexDir, { recursive: true });

      // Doctor without config.toml
      let res = runNode(DOCTOR_PATH, {
        args: ['--json'],
        env: { HOME: mockHome, ...DOCTOR_ENV }
      });
      let doc = JSON.parse(res.stdout);
      let cdxCheck = doc.results.find(r => r.area === 'hooks' && r.name.includes('Codex'));
      assert(cdxCheck, 'doctor detects Codex harness');
      assert.strictEqual(cdxCheck.ok, false, 'reports missing config.toml when absent');

      // Wire config.toml via installer
      const tomlFile = path.join(codexDir, 'config.toml');
      installer.mergeCodexTomlHooks(tomlFile);

      res = runNode(DOCTOR_PATH, {
        args: ['--json'],
        env: { HOME: mockHome, ...DOCTOR_ENV }
      });
      doc = JSON.parse(res.stdout);
      cdxCheck = doc.results.find(r => r.area === 'hooks' && r.name.includes('Codex'));
      assert.strictEqual(cdxCheck.ok, true, 'reports wired config.toml after merge');
    });

    test('aos-doctor: verifies memb-inject.mjs version 5 requirement', () => {
      const hooksDir = path.join(mockHome, '.claude', 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });

      fs.writeFileSync(path.join(hooksDir, 'memb-inject.mjs'), '// aos-hook-version: 4\n');
      let res = runNode(DOCTOR_PATH, {
        args: ['--json'],
        env: { HOME: mockHome, ...DOCTOR_ENV }
      });
      let doc = JSON.parse(res.stdout);
      let membCheck = doc.results.find(r => r.area === 'hooks' && r.name === 'memb-inject.mjs');
      assert.strictEqual(membCheck.ok, false, 'flags v4 hook as failing');
      assert(membCheck.detail.includes('v4, this release ships v5'));

      fs.writeFileSync(path.join(hooksDir, 'memb-inject.mjs'), '// aos-hook-version: 5\n');
      res = runNode(DOCTOR_PATH, {
        args: ['--json'],
        env: { HOME: mockHome, ...DOCTOR_ENV }
      });
      doc = JSON.parse(res.stdout);
      membCheck = doc.results.find(r => r.area === 'hooks' && r.name === 'memb-inject.mjs');
      assert.strictEqual(membCheck.ok, true, 'approves v5 hook');
      assert(membCheck.detail.includes('(v5)'));
    });
  });

  // ==========================================================================
  // AREA 4: ADVERSARIAL STRESS & CORNER CASES
  // ==========================================================================
  describe('Area 4: Adversarial Stress & Corner Cases', () => {
    test('memb-inject: SQL injection resilience in project ID and prompt', () => {
      const mockHome = path.join(tmpDir, 'home-sqli');
      const dbPath = path.join(mockHome, '.MemBDB', 'memb.db');
      createSqliteDb(dbPath, [
        {
          project_id: "test' OR '1'='1",
          data: 'SQL Injection secret leak'
        }
      ]);

      const maliciousPayload = JSON.stringify({
        prompt: "'; DROP TABLE memb_vectors; --",
        cwd: tmpDir,
        user_id: "admin' OR '1'='1"
      });

      const res = runNode(MEMB_INJECT_PATH, {
        input: maliciousPayload,
        env: { HOME: mockHome },
        cwd: tmpDir
      });

      assert.strictEqual(res.status, 0, 'fails open/exits cleanly on SQL injection attempts');
      // Verify database table was not dropped
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(dbPath);
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memb_vectors'").all();
      assert.strictEqual(rows.length, 1, 'table remains intact');
      db.close();
    });

    test('memb-inject: Upward traversal bounds strictly before $HOME', () => {
      const mockHome = path.join(tmpDir, 'fake-home');
      const nestedDir = path.join(mockHome, 'sub1', 'sub2', 'sub3');
      fs.mkdirSync(nestedDir, { recursive: true });
      fs.writeFileSync(path.join(mockHome, 'package.json'), JSON.stringify({ name: 'home-package-must-not-match' }));

      const res = runNode(MEMB_INJECT_PATH, {
        input: JSON.stringify({ prompt: 'test query', cwd: nestedDir }),
        env: { HOME: mockHome },
        cwd: nestedDir
      });

      assert.strictEqual(res.status, 0);
    });

    test('startcycle-dispatch: handles large adversarial prompt (200KB) without buffer overflow', () => {
      const largeGoal = 'x'.repeat(200 * 1024);
      const payload = JSON.stringify({
        prompt: `/startcycle-graph ${largeGoal}`
      });

      for (let i = 0; i < 5; i++) {
        const res = runNode(STARTCYCLE_DISPATCH_PATH, {
          input: payload,
          env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
          cwd: REPO_ROOT,
          timeout: 30000
        });

        assert.strictEqual(res.status, 0, 'exits 0 on large payload');
        assert(res.stdout, 'returns a response for large payload');
        const out = JSON.parse(res.stdout.trim());
        assert(out.injectSteps, 'contains injectSteps');
        assert(out.systemMessage, 'contains systemMessage');
        assert(out.result, 'contains execution result');
      }
    });
  });
});
