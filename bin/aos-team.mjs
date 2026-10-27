#!/usr/bin/env node
import '../lib/cli-help-guard.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { teamRegistry, teamFromPlaybook, validateTeamFields, effortRounds } from '../lib/roles/team.mjs';
import { loadRoleRegistry } from '../lib/roles/role-registry.mjs';

function printHelp() {
  console.log(`aos-team — manage and inspect agent teams

Usage:
  aos-team list [--json]
  aos-team show <id> [--json]
  aos-team new <id> [--from-playbook <name>] [--json]

Options:
  --json                  Output results in JSON format
  --from-playbook <name>  Derive team definition from a playbook's requirements
  --home <dir>            Override home directory (defaults to $HOME)
  --cwd <dir>             Override working directory (defaults to process.cwd())
  -h, --help              Show this help message
`);
}

/**
 * CLI entrypoint for aos-team.
 * @param {string[]} [argv]
 * @returns {Promise<number>} Exit code
 */
export async function main(argv = process.argv.slice(2)) {
  let jsonMode = false;
  const fail = (jsonMsg, plainMsg) => {
    if (jsonMode) console.log(JSON.stringify({ error: jsonMsg }, null, 2));
    else console.error(plainMsg);
    return 1;
  };
  let fromPlaybook = null;
  let homeDir = null;
  let cwdDir = null;
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      jsonMode = true;
    } else if (arg === '--from-playbook') {
      fromPlaybook = argv[++i];
    } else if (arg.startsWith('--from-playbook=')) {
      fromPlaybook = arg.slice('--from-playbook='.length);
    } else if (arg === '--home') {
      homeDir = argv[++i];
    } else if (arg.startsWith('--home=')) {
      homeDir = arg.slice('--home='.length);
    } else if (arg === '--cwd') {
      cwdDir = argv[++i];
    } else if (arg.startsWith('--cwd=')) {
      cwdDir = arg.slice('--cwd='.length);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      return 0;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    } else {
      return fail(`Unknown flag: ${arg}`, `Unknown flag: ${arg}`);
    }
  }

  const effectiveCwd = cwdDir ? resolve(cwdDir) : process.cwd();
  const effectiveHome = homeDir ? resolve(homeDir) : (typeof process.env.HOME === 'string' && process.env.HOME.length > 0 ? resolve(process.env.HOME) : homedir());

  const command = positional[0];

  if (!command || command === 'help') {
    printHelp();
    return command === 'help' ? 0 : 1;
  }

  if (command === 'list') {
    const reg = teamRegistry({ cwd: effectiveCwd, home: effectiveHome });
    const teams = reg.list();

    if (jsonMode) {
      const output = teams.map((t) => ({
        id: t.id,
        label: t.label,
        roles: t.roles,
        playbooks: t.playbooks || [],
        gates: t.gates || [],
        effort: t.effort || 'S',
        tier: t._tier,
        source: t._file || t._tier,
      }));
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`AOS Teams (${teams.length}):\n`);
      for (const t of teams) {
        console.log(`- ${t.id} (${t.label}) [tier: ${t._tier}]`);
        console.log(`  Roles (${t.roles.length}): ${t.roles.join(', ')}`);
        console.log(`  Effort: ${t.effort} (${effortRounds(t.effort)} rounds)`);
        if (t.playbooks?.length) console.log(`  Playbooks: ${t.playbooks.join(', ')}`);
        if (t.gates?.length) console.log(`  Gates: ${t.gates.join(', ')}`);
        console.log('');
      }
    }
    return 0;
  }

  if (command === 'show') {
    const id = positional[1];
    if (!id) {
      return fail('Missing team id. Usage: aos-team show <id> [--json]', 'Error: missing team id. Usage: aos-team show <id> [--json]');
    }

    const reg = teamRegistry({ cwd: effectiveCwd, home: effectiveHome });
    const team = reg.get(id);

    if (!team) {
      return fail(`Team "${id}" not found`, `Error: Team "${id}" not found.`);
    }

    if (jsonMode) {
      const output = {
        id: team.id,
        label: team.label,
        roles: team.roles,
        playbooks: team.playbooks || [],
        gates: team.gates || [],
        effort: team.effort || 'S',
        tier: team._tier,
        source: team._file || team._tier,
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Team: ${team.id}`);
      console.log(`Label: ${team.label}`);
      console.log(`Tier: ${team._tier}`);
      console.log(`Source: ${team._file || team._tier}`);
      console.log(`Effort: ${team.effort} (${effortRounds(team.effort)} rounds)`);
      console.log(`Roles (${team.roles.length}):`);
      for (const r of team.roles) {
        console.log(`  - ${r}`);
      }
      console.log(`Playbooks: ${team.playbooks?.length ? team.playbooks.join(', ') : 'none'}`);
      console.log(`Gates: ${team.gates?.length ? team.gates.join(', ') : 'none'}`);
    }
    return 0;
  }

  if (command === 'new') {
    const id = positional[1];
    if (!id) {
      return fail('Missing team id. Usage: aos-team new <id> [--from-playbook <name>] [--json]', 'Error: missing team id. Usage: aos-team new <id> [--from-playbook <name>] [--json]');
    }

    if (!/^[a-z0-9_-]+$/.test(id)) {
      return fail(`Invalid team id "${id}". Must match ^[a-z0-9_-]+$`, `Error: Invalid team id "${id}". Must match ^[a-z0-9_-]+$`);
    }

    const targetDir = join(effectiveCwd, '.aos', 'teams');
    const targetFile = join(targetDir, `${id}.json`);

    if (existsSync(targetFile)) {
      return fail(`Team "${id}" already exists at ${targetFile}`, `Error: Team "${id}" already exists at ${targetFile}`);
    }

    let teamData;
    if (fromPlaybook) {
      try {
        const roleReg = loadRoleRegistry({ cwd: effectiveCwd, home: effectiveHome });
        const derived = teamFromPlaybook(fromPlaybook, {
          cwd: effectiveCwd,
          home: effectiveHome,
          roleRegistry: roleReg,
          id,
        });

        teamData = {
          id,
          label: derived.team.label || `${id} Team`,
          roles: derived.team.roles.length > 0
            ? derived.team.roles
            : ['architect', 'techlead', 'engineering', 'reviewer', 'shipping'],
          playbooks: derived.team.playbooks || [fromPlaybook],
          gates: derived.team.gates || [],
          effort: derived.team.effort || 'S',
        };
      } catch (err) {
        return fail(`Failed to derive team from playbook "${fromPlaybook}": ${err.message}`, `Error: Failed to derive team from playbook "${fromPlaybook}": ${err.message}`);
      }
    } else {
      const formattedLabel = id
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      teamData = {
        id,
        label: `${formattedLabel} Team`,
        roles: ['architect', 'techlead', 'engineering', 'reviewer', 'shipping'],
        playbooks: [],
        gates: [],
        effort: 'S',
      };
    }

    const { valid, errors } = validateTeamFields(teamData);
    if (!valid) {
      const msg = errors.map((e) => e.message).join('; ');
      return fail(`Validation error: ${msg}`, `Error: Validation error: ${msg}`);
    }

    mkdirSync(targetDir, { recursive: true });
    writeFileSync(targetFile, JSON.stringify(teamData, null, 2) + '\n', 'utf8');

    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, file: targetFile, team: teamData }, null, 2));
    } else {
      console.log(`Created team "${id}" at ${targetFile}`);
    }
    return 0;
  }

  return fail(`Unknown command "${command}"`, `Unknown command "${command}". Run "aos-team --help" for usage.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => {
    process.exit(code ?? 0);
  });
}
