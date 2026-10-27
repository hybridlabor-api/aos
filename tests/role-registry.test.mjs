import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  loadRoleRegistry,
  validateRoleFields,
  normalizeRole,
  deriveShippedRoles,
  ALLOWED_ROLE_FIELDS,
  ROLE_TYPES
} from '../lib/roles/role-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

describe('role-registry', () => {
  let tempHome;
  let tempCwd;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'aos-home-test-'));
    tempCwd = mkdtempSync(join(tmpdir(), 'aos-cwd-test-'));
  });

  test('default registry contains the 7 nodes.json nodes plus shipped roles', () => {
    // Inject clean temp home and temp project dir with no custom roles, but pointing to real repo nodes.json, shipped-roles and skills
    const reg = loadRoleRegistry({
      cwd: REPO_ROOT,
      home: tempHome,
      projectRolesDir: join(tempCwd, '.aos', 'roles'),
      userRolesDir: join(tempHome, '.aos', 'roles')
    });

    const expectedIds = [
      'architect', 'engineering', 'media_eventtech', 'reviewer', 'shipping', 'techlead', 'ui_ux',
      'tauri_expert', 'copywriter', 'event_manager'
    ].sort();
    const actualIds = reg.list().map((r) => r.id).sort();

    assert.deepEqual(actualIds, expectedIds);
    assert.equal(reg.errors.length, 0, `Expected 0 errors, got: ${JSON.stringify(reg.errors)}`);

    for (const id of expectedIds) {
      assert.ok(reg.has(id));
      const role = reg.get(id);
      assert.equal(role.id, id);
      assert.equal(role._tier, 'shipped');
      assert.ok(ROLE_TYPES.has(role.role));
      assert.ok(Array.isArray(role.skills));
      assert.ok(Array.isArray(role.playbooks));
      assert.ok(Array.isArray(role.tools));
      assert.ok(Array.isArray(role.gates));
    }
  });

  test('precedence order: project > user > shipped', () => {
    const userRolesDir = join(tempHome, '.aos', 'roles');
    const projectRolesDir = join(tempCwd, '.aos', 'roles');
    mkdirSync(userRolesDir, { recursive: true });
    mkdirSync(projectRolesDir, { recursive: true });

    // 1. User overrides shipped "engineering"
    writeFileSync(
      join(userRolesDir, 'engineering.json'),
      JSON.stringify({
        id: 'engineering',
        label: 'Custom User Engineering',
        role: 'build',
        persona: 'User backend persona',
        skills: ['software-architecture'],
        tools: ['cargo']
      })
    );

    // 2. User creates a new role "security_specialist"
    writeFileSync(
      join(userRolesDir, 'security_specialist.json'),
      JSON.stringify({
        id: 'security_specialist',
        label: 'User Security Specialist',
        role: 'specialist',
        persona: 'User security persona',
        skills: ['clean-code']
      })
    );

    // 3. Project overrides "security_specialist"
    writeFileSync(
      join(projectRolesDir, 'security_specialist.json'),
      JSON.stringify({
        id: 'security_specialist',
        label: 'Project Security Specialist',
        role: 'specialist',
        persona: 'Project security persona',
        skills: ['clean-code'],
        tools: ['semgrep']
      })
    );

    // 4. Project overrides shipped "architect"
    writeFileSync(
      join(projectRolesDir, 'architect.json'),
      JSON.stringify({
        id: 'architect',
        label: 'Project Custom Architect',
        role: 'plan',
        persona: 'Project plan persona'
      })
    );

    const reg = loadRoleRegistry({
      cwd: REPO_ROOT,
      home: tempHome,
      projectRolesDir,
      userRolesDir
    });

    // Check user override of shipped role
    const eng = reg.get('engineering');
    assert.equal(eng._tier, 'user');
    assert.equal(eng._overrides, 'shipped');
    assert.equal(eng.label, 'Custom User Engineering');
    assert.deepEqual(eng.tools, ['cargo']);

    // Check project override of user role
    const sec = reg.get('security_specialist');
    assert.equal(sec._tier, 'project');
    assert.equal(sec._overrides, 'user');
    assert.equal(sec.label, 'Project Security Specialist');
    assert.deepEqual(sec.tools, ['semgrep']);

    // Check project override of shipped role
    const arch = reg.get('architect');
    assert.equal(arch._tier, 'project');
    assert.equal(arch._overrides, 'shipped');
    assert.equal(arch.label, 'Project Custom Architect');

    // Unoverridden shipped role stays shipped
    const rev = reg.get('reviewer');
    assert.equal(rev._tier, 'shipped');
    assert.equal(rev.label, 'Reviewer');
  });

  test('rejection of bad roles and collection of clear errors', () => {
    const userRolesDir = join(tempHome, '.aos', 'roles');
    mkdirSync(userRolesDir, { recursive: true });

    // Unknown field
    writeFileSync(
      join(userRolesDir, 'bad_unknown.json'),
      JSON.stringify({
        id: 'bad_unknown',
        label: 'Bad Unknown',
        role: 'build',
        persona: 'test',
        extra_illegal_field: 123
      })
    );

    // Invalid id regex (hyphens not allowed by ^[a-z0-9_]+$)
    writeFileSync(
      join(userRolesDir, 'bad-hyphen-id.json'),
      JSON.stringify({
        id: 'bad-hyphen-id',
        label: 'Bad Hyphen',
        role: 'build',
        persona: 'test'
      })
    );

    // Missing persona and personaFile
    writeFileSync(
      join(userRolesDir, 'bad_nopersona.json'),
      JSON.stringify({
        id: 'bad_nopersona',
        label: 'Bad No Persona',
        role: 'build'
      })
    );

    // Invalid role type
    writeFileSync(
      join(userRolesDir, 'bad_role_type.json'),
      JSON.stringify({
        id: 'bad_role_type',
        label: 'Bad Role',
        role: 'developer_wizard',
        persona: 'test'
      })
    );

    // Invalid model tier
    writeFileSync(
      join(userRolesDir, 'bad_tier.json'),
      JSON.stringify({
        id: 'bad_tier',
        label: 'Bad Tier',
        role: 'build',
        persona: 'test',
        model_tier: 'gpt4_turbo'
      })
    );

    // Invalid JSON file
    writeFileSync(join(userRolesDir, 'malformed.json'), '{ not valid json');

    const reg = loadRoleRegistry({
      cwd: REPO_ROOT,
      home: tempHome,
      userRolesDir
    });

    // None of the bad roles should be registered
    assert.equal(reg.has('bad_unknown'), false);
    assert.equal(reg.has('bad-hyphen-id'), false);
    assert.equal(reg.has('bad_nopersona'), false);
    assert.equal(reg.has('bad_role_type'), false);
    assert.equal(reg.has('bad_tier'), false);

    // Errors should be collected with code, file, and message
    assert.ok(reg.errors.length >= 6);
    assert.ok(reg.errors.some((e) => e.code === 'ERR_UNKNOWN_FIELD' && e.field === 'extra_illegal_field'));
    assert.ok(reg.errors.some((e) => e.code === 'ERR_INVALID_ID'));
    assert.ok(reg.errors.some((e) => e.code === 'ERR_MISSING_PERSONA'));
    assert.ok(reg.errors.some((e) => e.code === 'ERR_INVALID_ROLE_TYPE'));
    assert.ok(reg.errors.some((e) => e.code === 'ERR_INVALID_MODEL_TIER'));
    assert.ok(reg.errors.some((e) => e.code === 'ERR_INVALID_JSON'));
  });

  test('duplicate ID within same tier is rejected', () => {
    const userRolesDir = join(tempHome, '.aos', 'roles');
    mkdirSync(userRolesDir, { recursive: true });

    writeFileSync(
      join(userRolesDir, 'role_a.json'),
      JSON.stringify({
        id: 'duplicate_worker',
        label: 'First worker',
        role: 'build',
        persona: 'worker one'
      })
    );

    writeFileSync(
      join(userRolesDir, 'role_b.json'),
      JSON.stringify({
        id: 'duplicate_worker',
        label: 'Second worker',
        role: 'build',
        persona: 'worker two'
      })
    );

    const reg = loadRoleRegistry({
      cwd: REPO_ROOT,
      home: tempHome,
      userRolesDir
    });

    assert.ok(reg.errors.some((e) => e.code === 'ERR_DUPLICATE_ID' && e.roleId === 'duplicate_worker'));
    // Exactly one was registered
    assert.equal(reg.get('duplicate_worker').label, 'First worker');
  });

  test('reports unresolved skills with role id', () => {
    const projectRolesDir = join(tempCwd, '.aos', 'roles');
    mkdirSync(projectRolesDir, { recursive: true });

    writeFileSync(
      join(projectRolesDir, 'quantum_specialist.json'),
      JSON.stringify({
        id: 'quantum_specialist',
        label: 'Quantum Specialist',
        role: 'specialist',
        persona: 'quantum computing expert',
        skills: ['software-architecture', 'nonexistent_quantum_skill_xyz']
      })
    );

    const reg = loadRoleRegistry({
      cwd: REPO_ROOT,
      home: tempHome,
      projectRolesDir
    });

    assert.ok(reg.has('quantum_specialist'));
    assert.ok(
      reg.unresolvedSkills.some(
        (u) => u.roleId === 'quantum_specialist' && u.skill === 'nonexistent_quantum_skill_xyz'
      ),
      `Expected unresolved skill report, got: ${JSON.stringify(reg.unresolvedSkills)}`
    );
  });

  test('validates playbooks against skills/playbooks', () => {
    const projectRolesDir = join(tempCwd, '.aos', 'roles');
    mkdirSync(projectRolesDir, { recursive: true });

    writeFileSync(
      join(projectRolesDir, 'bad_playbook_role.json'),
      JSON.stringify({
        id: 'bad_playbook_role',
        label: 'Bad Playbook Role',
        role: 'build',
        persona: 'test persona',
        playbooks: ['pb-project-new', 'pb-nonexistent-imaginary-flow']
      })
    );

    const reg = loadRoleRegistry({
      cwd: REPO_ROOT,
      home: tempHome,
      projectRolesDir
    });

    assert.ok(
      reg.errors.some(
        (e) =>
          e.code === 'ERR_UNRESOLVED_PLAYBOOK' &&
          e.roleId === 'bad_playbook_role' &&
          e.playbook === 'pb-nonexistent-imaginary-flow'
      ),
      `Expected ERR_UNRESOLVED_PLAYBOOK, got: ${JSON.stringify(reg.errors)}`
    );
  });

  test('HOME is parameter-injected and process.env.HOME is never accessed inside registry', () => {
    // If home parameter is not provided or null, user tier is omitted
    const regWithoutHome = loadRoleRegistry({
      cwd: REPO_ROOT,
      home: null,
      projectRolesDir: join(tempCwd, '.aos', 'roles')
    });

    assert.equal(regWithoutHome.userRoles.size, 0);

    // If home is provided, user tier loads from that specific directory
    const userRolesDir = join(tempHome, '.aos', 'roles');
    mkdirSync(userRolesDir, { recursive: true });
    writeFileSync(
      join(userRolesDir, 'custom_user_node.json'),
      JSON.stringify({
        id: 'custom_user_node',
        label: 'Custom User Node',
        role: 'specialist',
        persona: 'testing injected home'
      })
    );

    const regWithInjectedHome = loadRoleRegistry({
      cwd: REPO_ROOT,
      home: tempHome,
      projectRolesDir: join(tempCwd, '.aos', 'roles')
    });

    assert.ok(regWithInjectedHome.has('custom_user_node'));
    assert.equal(regWithInjectedHome.get('custom_user_node')._tier, 'user');
  });
});
