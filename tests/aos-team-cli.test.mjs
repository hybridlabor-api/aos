import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main } from '../bin/aos-team.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Helper to capture console.log and console.error output
async function runCli(args) {
  const stdout = [];
  const stderr = [];
  const origLog = console.log;
  const origErr = console.error;

  console.log = (...msgs) => stdout.push(msgs.join(' '));
  console.error = (...msgs) => stderr.push(msgs.join(' '));

  try {
    const code = await main(args);
    return {
      code,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

describe('aos-team CLI', () => {
  test('list command outputs human readable text with shipped default team', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'aos-cli-test-home-'));
    const tmpCwd = mkdtempSync(join(tmpdir(), 'aos-cli-test-cwd-'));

    const res = await runCli(['list', '--home', tmpHome, '--cwd', tmpCwd]);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /AOS Teams/);
    assert.match(res.stdout, /- default \(Default Team\) \[tier: shipped\]/);
    assert.match(res.stdout, /Roles \(7\): architect, techlead, ui_ux, engineering, media_eventtech, reviewer, shipping/);
    assert.match(res.stdout, /Effort: S \(3 rounds\)/);
  });

  test('list --json outputs valid JSON array of teams', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'aos-cli-test-home-'));
    const tmpCwd = mkdtempSync(join(tmpdir(), 'aos-cli-test-cwd-'));

    const res = await runCli(['list', '--json', '--home', tmpHome, '--cwd', tmpCwd]);
    assert.equal(res.code, 0);
    const parsed = JSON.parse(res.stdout);
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'default');
    assert.equal(parsed[0].tier, 'shipped');
    assert.equal(parsed[0].effort, 'S');
    assert.equal(parsed[0].roles.length, 7);
  });

  test('show command outputs details for shipped default team', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'aos-cli-test-home-'));
    const tmpCwd = mkdtempSync(join(tmpdir(), 'aos-cli-test-cwd-'));

    const res = await runCli(['show', 'default', '--home', tmpHome, '--cwd', tmpCwd]);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Team: default/);
    assert.match(res.stdout, /Label: Default Team/);
    assert.match(res.stdout, /Tier: shipped/);
    assert.match(res.stdout, /Effort: S \(3 rounds\)/);
    assert.match(res.stdout, /- engineering/);
  });

  test('show --json outputs structured team object', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'aos-cli-test-home-'));
    const tmpCwd = mkdtempSync(join(tmpdir(), 'aos-cli-test-cwd-'));

    const res = await runCli(['show', 'default', '--json', '--home', tmpHome, '--cwd', tmpCwd]);
    assert.equal(res.code, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.id, 'default');
    assert.equal(parsed.label, 'Default Team');
    assert.equal(parsed.tier, 'shipped');
    assert.equal(parsed.effort, 'S');
    assert.deepEqual(parsed.roles, [
      'architect', 'techlead', 'ui_ux', 'engineering', 'media_eventtech', 'reviewer', 'shipping'
    ]);
  });

  test('show nonexistent team returns error code 1', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'aos-cli-test-home-'));
    const tmpCwd = mkdtempSync(join(tmpdir(), 'aos-cli-test-cwd-'));

    const res = await runCli(['show', 'nonexistent', '--home', tmpHome, '--cwd', tmpCwd]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Team "nonexistent" not found/);

    const jsonRes = await runCli(['show', 'nonexistent', '--json', '--home', tmpHome, '--cwd', tmpCwd]);
    assert.equal(jsonRes.code, 1);
    const parsed = JSON.parse(jsonRes.stdout);
    assert.ok(parsed.error);
    assert.match(parsed.error, /Team "nonexistent" not found/);
  });

  test('new command creates team JSON in .aos/teams without overwriting', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'aos-cli-test-home-'));
    const tmpCwd = mkdtempSync(join(tmpdir(), 'aos-cli-test-cwd-'));

    const res = await runCli(['new', 'backend_crew', '--cwd', tmpCwd, '--home', tmpHome]);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Created team "backend_crew"/);

    const teamFile = join(tmpCwd, '.aos', 'teams', 'backend_crew.json');
    assert.ok(existsSync(teamFile));

    const content = JSON.parse(readFileSync(teamFile, 'utf8'));
    assert.equal(content.id, 'backend_crew');
    assert.equal(content.label, 'Backend Crew Team');
    assert.equal(content.effort, 'S');
    assert.ok(Array.isArray(content.roles));

    // Refuses to overwrite
    const dupeRes = await runCli(['new', 'backend_crew', '--cwd', tmpCwd, '--home', tmpHome]);
    assert.equal(dupeRes.code, 1);
    assert.match(dupeRes.stderr, /already exists/);
  });

  test('new --json outputs structured success result', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'aos-cli-test-home-'));
    const tmpCwd = mkdtempSync(join(tmpdir(), 'aos-cli-test-cwd-'));

    const res = await runCli(['new', 'qa_fleet', '--json', '--cwd', tmpCwd, '--home', tmpHome]);
    assert.equal(res.code, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.team.id, 'qa_fleet');
    assert.ok(existsSync(parsed.file));
  });

  test('new --from-playbook derives team from pb-tauri-e2e', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'aos-cli-test-home-'));
    const tmpCwd = mkdtempSync(join(tmpdir(), 'aos-cli-test-cwd-'));

    const playbookPath = join(root, 'skills', 'playbooks', 'pb-tauri-e2e', 'SKILL.md');

    const res = await runCli([
      'new', 'desktop_tauri',
      '--from-playbook', playbookPath,
      '--cwd', tmpCwd,
      '--home', tmpHome,
    ]);
    assert.equal(res.code, 0);

    const teamFile = join(tmpCwd, '.aos', 'teams', 'desktop_tauri.json');
    assert.ok(existsSync(teamFile));

    const content = JSON.parse(readFileSync(teamFile, 'utf8'));
    assert.equal(content.id, 'desktop_tauri');
    assert.deepEqual(content.playbooks, ['pb-tauri-e2e']);
    assert.ok(Array.isArray(content.roles));
  });

  test('new rejects invalid team id pattern', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'aos-cli-test-home-'));
    const tmpCwd = mkdtempSync(join(tmpdir(), 'aos-cli-test-cwd-'));

    const res = await runCli(['new', 'Bad!ID', '--cwd', tmpCwd, '--home', tmpHome]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Invalid team id/);
  });

  test('help displays usage and returns 0', async () => {
    const res = await runCli(['--help']);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /aos-team — manage and inspect agent teams/);
    assert.match(res.stdout, /aos-team list/);
    assert.match(res.stdout, /aos-team show/);
    assert.match(res.stdout, /aos-team new/);
  });
});
