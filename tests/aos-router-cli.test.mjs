'use strict';

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'aos-router.mjs');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-router-cli-test-'));
after(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

function run(args, { home, cwd = ROOT } = {}) {
  const env = { ...process.env, HOME: home || tmpBase };
  delete env.USERPROFILE;
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('aos-router CLI read-only commands', () => {
  test('show prints effective table and provenance', () => {
    const home = path.join(tmpBase, 'show-home');
    const projectRoot = path.join(tmpBase, 'show-project');
    fs.mkdirSync(path.join(projectRoot, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.aos', 'router.json'), JSON.stringify({
      preferences: { architect: ['agy'] },
    }));
    const r = run(['show'], { home, cwd: projectRoot });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /Effective routing table/);
    assert.match(r.stdout, /architect=project/);
    assert.match(r.stdout, /builder=shipped/);
  });

  test('show --json returns structured table and sources', () => {
    const home = path.join(tmpBase, 'show-json-home');
    const projectRoot = path.join(tmpBase, 'show-json-project');
    fs.mkdirSync(path.join(projectRoot, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.aos', 'router.json'), JSON.stringify({
      preferences: { reviewer: ['codex'] },
    }));
    const r = run(['show', '--json'], { home, cwd: projectRoot });
    assert.strictEqual(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.sources.reviewer, 'project');
    assert.deepStrictEqual(data.table.preferences.reviewer, ['codex']);
  });

  test('limits prints current limits', () => {
    const home = path.join(tmpBase, 'limits-home');
    const r = run(['limits'], { home });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /window_5h/);
    assert.match(r.stdout, /weekly/);
  });

  test('limits --json returns limits object', () => {
    const home = path.join(tmpBase, 'limits-json-home');
    const r = run(['limits', '--json'], { home });
    assert.strictEqual(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.window_5h.soft, 0.8);
  });

  test('test prints route for a role', () => {
    const home = path.join(tmpBase, 'test-home');
    const r = run(['test', 'builder'], { home });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /would route to: opencode-go/);
    assert.match(r.stdout, /glm-5\.3-flash/);
  });

  test('test --json returns route object', () => {
    const home = path.join(tmpBase, 'test-json-home');
    const r = run(['test', 'architect', '--json'], { home });
    assert.strictEqual(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.target, 'claude');
    assert.strictEqual(data.model, null);
    assert.ok(data.reason);
  });
});

describe('aos-router CLI set command', () => {
  test('set writes user router.json by default', () => {
    const home = path.join(tmpBase, 'set-user-home');
    const r = run(['set', 'architect', 'agy,claude'], { home });
    assert.strictEqual(r.status, 0, r.stderr);
    const written = JSON.parse(fs.readFileSync(path.join(home, '.aos', 'router.json'), 'utf8'));
    assert.deepStrictEqual(written.preferences.architect, ['agy', 'claude']);
  });

  test('set --project writes project router.json', () => {
    const home = path.join(tmpBase, 'set-project-home');
    const projectRoot = path.join(tmpBase, 'set-project-project');
    fs.mkdirSync(path.join(projectRoot, '.aos'), { recursive: true });
    const r = run(['set', '--project', 'builder', 'opencode-go,agy'], { home, cwd: projectRoot });
    assert.strictEqual(r.status, 0, r.stderr);
    const written = JSON.parse(fs.readFileSync(path.join(projectRoot, '.aos', 'router.json'), 'utf8'));
    assert.deepStrictEqual(written.preferences.builder, ['opencode-go', 'agy']);
  });

  test('set rejects unknown role', () => {
    const home = path.join(tmpBase, 'set-bad-role-home');
    const r = run(['set', 'wizard', 'claude'], { home });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /unknown role "wizard"/);
  });

  test('set rejects unknown target', () => {
    const home = path.join(tmpBase, 'set-bad-target-home');
    const r = run(['set', 'architect', 'magic'], { home });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /unknown target\(s\): magic/);
  });

  test('set validates merged result and rejects conflicting project layer', () => {
    const home = path.join(tmpBase, 'set-conflict-home');
    const projectRoot = path.join(tmpBase, 'set-conflict-project');
    fs.mkdirSync(path.join(projectRoot, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.aos', 'router.json'), JSON.stringify({
      roles: ['architect', 'ninja'],
      targets: { claude: {} },
    }));
    const r = run(['set', '--project', 'architect', 'agy'], { home, cwd: projectRoot });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /Unknown role "ninja"/);
  });
});

describe('aos-router CLI error handling', () => {
  test('unknown command exits with usage', () => {
    const home = path.join(tmpBase, 'err-home');
    const r = run(['frobnicate'], { home });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /unknown command/);
  });

  test('set without enough arguments errors', () => {
    const home = path.join(tmpBase, 'err-set-home');
    const r = run(['set', 'architect'], { home });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /set needs <role> <target/);
  });
});
