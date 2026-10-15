import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  loadTeamRegistry,
  validateTeamFields,
  normalizeTeam,
  effortRounds,
  teamFromPlaybook,
  SHIPPED_DEFAULT_TEAM,
  EFFORTS
} from '../lib/roles/team.mjs';

import { loadRoleRegistry } from '../lib/roles/role-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

describe('team registry and teamFromPlaybook', () => {
  let tempHome;
  let tempCwd;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'aos-team-home-'));
    tempCwd = mkdtempSync(join(tmpdir(), 'aos-team-cwd-'));
  });

  test('default team has 7 nodes, effort S (3 rounds)', () => {
    const reg = loadTeamRegistry({
      cwd: REPO_ROOT,
      home: tempHome,
      projectTeamsDir: join(tempCwd, '.aos', 'teams'),
      userTeamsDir: join(tempHome, '.aos', 'teams')
    });

    assert.equal(reg.has('default'), true);
    const def = reg.get('default');
    assert.equal(def.id, 'default');
    assert.equal(def.label, 'Default Team');
    assert.equal(def.effort, 'S');
    assert.equal(effortRounds(def.effort), 3);

    const expected7 = ['architect', 'techlead', 'ui_ux', 'engineering', 'media_eventtech', 'reviewer', 'shipping'];
    assert.deepEqual(def.roles, expected7);
  });

  test('effortRounds maps S=3, M=4, L=5', () => {
    assert.equal(effortRounds('S'), 3);
    assert.equal(effortRounds('M'), 4);
    assert.equal(effortRounds('L'), 5);
    assert.equal(effortRounds('unknown'), 3);
    assert.equal(effortRounds(), 3);
  });

  test('team tiers precedence: project > user > shipped', () => {
    const userTeamsDir = join(tempHome, '.aos', 'teams');
    const projectTeamsDir = join(tempCwd, '.aos', 'teams');
    mkdirSync(userTeamsDir, { recursive: true });
    mkdirSync(projectTeamsDir, { recursive: true });

    // User overrides default team
    writeFileSync(
      join(userTeamsDir, 'default.json'),
      JSON.stringify({
        id: 'default',
        label: 'User Custom Default',
        roles: ['architect', 'engineering', 'shipping'],
        effort: 'M'
      })
    );

    // User creates desktop team
    writeFileSync(
      join(userTeamsDir, 'desktop.json'),
      JSON.stringify({
        id: 'desktop',
        label: 'User Desktop Team',
        roles: ['engineering', 'reviewer'],
        effort: 'S'
      })
    );

    // Project overrides desktop team
    writeFileSync(
      join(projectTeamsDir, 'desktop.json'),
      JSON.stringify({
        id: 'desktop',
        label: 'Project Desktop Team',
        roles: ['engineering', 'reviewer', 'shipping'],
        effort: 'L'
      })
    );

    const reg = loadTeamRegistry({
      cwd: REPO_ROOT,
      home: tempHome,
      projectTeamsDir,
      userTeamsDir
    });

    const def = reg.get('default');
    assert.equal(def._tier, 'user');
    assert.equal(def._overrides, 'shipped');
    assert.equal(def.label, 'User Custom Default');
    assert.equal(def.effort, 'M');

    const desk = reg.get('desktop');
    assert.equal(desk._tier, 'project');
    assert.equal(desk._overrides, 'user');
    assert.equal(desk.label, 'Project Desktop Team');
    assert.equal(desk.effort, 'L');
    assert.equal(effortRounds(desk.effort), 5);
  });

  test('team validation: unknown fields rejected, invalid effort rejected, duplicate id rejected', () => {
    const userTeamsDir = join(tempHome, '.aos', 'teams');
    mkdirSync(userTeamsDir, { recursive: true });

    // Unknown field
    writeFileSync(
      join(userTeamsDir, 'bad_field.json'),
      JSON.stringify({
        id: 'bad_field',
        label: 'Bad Field Team',
        roles: ['architect'],
        unexpectedField: 'forbidden'
      })
    );

    // Invalid effort
    writeFileSync(
      join(userTeamsDir, 'bad_effort.json'),
      JSON.stringify({
        id: 'bad_effort',
        label: 'Bad Effort Team',
        roles: ['architect'],
        effort: 'XL'
      })
    );

    // Duplicate IDs in same tier
    writeFileSync(
      join(userTeamsDir, 'team_1.json'),
      JSON.stringify({
        id: 'dupe_team',
        label: 'First dupe',
        roles: ['architect']
      })
    );
    writeFileSync(
      join(userTeamsDir, 'team_2.json'),
      JSON.stringify({
        id: 'dupe_team',
        label: 'Second dupe',
        roles: ['techlead']
      })
    );

    const reg = loadTeamRegistry({
      cwd: REPO_ROOT,
      home: tempHome,
      userTeamsDir
    });

    assert.equal(reg.has('bad_field'), false);
    assert.equal(reg.has('bad_effort'), false);
    assert.ok(reg.errors.some((e) => e.code === 'ERR_UNKNOWN_FIELD' && e.field === 'unexpectedField'));
    assert.ok(reg.errors.some((e) => e.code === 'ERR_INVALID_EFFORT'));
    assert.ok(reg.errors.some((e) => e.code === 'ERR_DUPLICATE_ID' && e.teamId === 'dupe_team'));
  });

  test('teamFromPlaybook derives a team from pb-tauri-e2e', () => {
    const roleRegistry = loadRoleRegistry({
      cwd: REPO_ROOT,
      home: tempHome
    });

    // pb-tauri-e2e exists under skills/playbooks/pb-tauri-e2e/SKILL.md
    const result = teamFromPlaybook('pb-tauri-e2e', {
      cwd: REPO_ROOT,
      roleRegistry
    });

    assert.ok(result.team);
    assert.equal(result.playbook, 'pb-tauri-e2e');
    assert.equal(result.team.id, 'pb-tauri-e2e');
    assert.deepEqual(result.team.playbooks, ['pb-tauri-e2e']);

    // pb-tauri-e2e requires:
    // agents: [reviewer, silent-failure-hunter, security-reviewer]
    // In default role registry, only "reviewer" is a registered role
    assert.deepEqual(result.team.roles, ['reviewer']);
    assert.deepEqual(result.missingRoles, ['silent-failure-hunter', 'security-reviewer']);

    // Skills attached
    assert.ok(result.skills.includes('godmode-engineering'));
    assert.ok(result.skills.includes('godmode-shipping'));
    assert.ok(result.skills.includes('webapp-testing'));

    // MCPs listed for checking
    assert.deepEqual(result.mcps, ['chrome-devtools', 'bdb-computer-use-mcp', 'open_design_mcp']);

    // Tools listed
    assert.deepEqual(result.tools, ['cargo', 'tauri-driver', 'npx', 'curl', 'lsof']);
  });

  test('teamFromPlaybook with custom role registry matching auxiliary agents', () => {
    const userRolesDir = join(tempHome, '.aos', 'roles');
    mkdirSync(userRolesDir, { recursive: true });

    // Register silent-failure-hunter and security-reviewer as user roles
    writeFileSync(
      join(userRolesDir, 'silent-failure-hunter.json'),
      JSON.stringify({
        id: 'silent_failure_hunter',
        label: 'Silent Failure Hunter',
        role: 'specialist',
        persona: 'hunter persona'
      })
    );
    writeFileSync(
      join(userRolesDir, 'security-reviewer.json'),
      JSON.stringify({
        id: 'security_reviewer',
        label: 'Security Reviewer',
        role: 'review',
        persona: 'security reviewer persona'
      })
    );

    const roleRegistry = loadRoleRegistry({
      cwd: REPO_ROOT,
      home: tempHome,
      userRolesDir
    });

    const result = teamFromPlaybook('skills/playbooks/pb-tauri-e2e/SKILL.md', {
      cwd: REPO_ROOT,
      roleRegistry,
      id: 'custom_tauri_team',
      label: 'Desktop Tauri Team',
      effort: 'L'
    });

    assert.equal(result.team.id, 'custom_tauri_team');
    assert.equal(result.team.label, 'Desktop Tauri Team');
    assert.equal(result.team.effort, 'L');
    assert.equal(effortRounds(result.team.effort), 5);
  });
});
