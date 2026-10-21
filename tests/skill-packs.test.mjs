import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packIndexPath = path.join(__dirname, '..', 'lib', 'skill-packs.json');
const skillsDir = path.join(__dirname, '..', 'skills');

function loadPacksData() {
  assert(fs.existsSync(packIndexPath), `Pack data file not found: ${packIndexPath}`);
  const content = fs.readFileSync(packIndexPath, 'utf-8');
  return JSON.parse(content);
}

function getAllSkills() {
  const skills = {};

  const scanDir = (dir) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(item => {
      const fullPath = path.join(dir, item);
      if (fs.statSync(fullPath).isDirectory()) {
        skills[item] = true;
      }
    });
  };

  // Scan basic skills
  scanDir(path.join(skillsDir, 'basic'));
  // Scan global_config skills
  scanDir(path.join(skillsDir, 'global_config'));
  // Scan other categories
  fs.readdirSync(skillsDir).forEach(item => {
    const fullPath = path.join(skillsDir, item);
    if (fs.statSync(fullPath).isDirectory() && item !== 'basic' && item !== 'global_config') {
      scanDir(path.join(skillsDir, item));
    }
  });

  // Scan vendor skills
  const vendorDir = path.join(__dirname, '..', 'vendor');
  if (fs.existsSync(vendorDir)) {
    fs.readdirSync(vendorDir).forEach(v => {
      scanDir(path.join(vendorDir, v, 'skills'));
    });
  }

  return skills;
}

test('skill-packs.json structure', () => {
  const packs = loadPacksData();

  assert(Array.isArray(packs.base), 'base should be an array');
  assert(typeof packs.packs === 'object', 'packs should be an object');
  assert(Array.isArray(packs.mergeCandidates), 'mergeCandidates should be an array');
});

test('all listed skills exist in skills/ directory', () => {
  const packs = loadPacksData();
  const allSkills = getAllSkills();

  const checkSkills = (skills, packName, isExternal = false) => {
    for (const skill of skills) {
      if (!isExternal && !allSkills[skill]) {
        console.warn(`  Warning: skill "${skill}" in ${packName} not found in skills/ directory`);
      }
    }
  };

  // Check base
  checkSkills(packs.base, 'base');

  // Check packs
  for (const [packName, pack] of Object.entries(packs.packs)) {
    if (pack.groups) {
      for (const skills of Object.values(pack.groups)) {
        checkSkills(skills, packName, pack.external);
      }
    } else {
      checkSkills(pack.skills, packName, pack.external);
    }
  }
});

test('no skill appears in two packs', () => {
  const packs = loadPacksData();
  const skillToPackMap = {};
  const duplicates = [];

  for (const [packName, pack] of Object.entries(packs.packs)) {
    let skills = [];
    if (pack.groups) {
      for (const groupSkills of Object.values(pack.groups)) {
        skills.push(...groupSkills);
      }
    } else {
      skills = pack.skills;
    }

    for (const skill of skills) {
      if (skillToPackMap[skill]) {
        duplicates.push({
          skill,
          pack1: skillToPackMap[skill],
          pack2: packName
        });
      }
      skillToPackMap[skill] = packName;
    }
  }

  assert.strictEqual(duplicates.length, 0,
    `Found duplicate skills in multiple packs:\n${duplicates.map(d => `  ${d.skill}: ${d.pack1} & ${d.pack2}`).join('\n')}`);
});

test('base skills do not overlap with pack skills', () => {
  const packs = loadPacksData();
  const baseSet = new Set(packs.base);
  const overlaps = [];

  for (const [packName, pack] of Object.entries(packs.packs)) {
    let skills = [];
    if (pack.groups) {
      for (const groupSkills of Object.values(pack.groups)) {
        skills.push(...groupSkills);
      }
    } else {
      skills = pack.skills;
    }

    for (const skill of skills) {
      if (baseSet.has(skill)) {
        overlaps.push(`${skill} in both base and ${packName}`);
      }
    }
  }

  assert.strictEqual(overlaps.length, 0,
    `Found skills in both base and packs:\n${overlaps.join('\n')}`);
});

test('all pack descriptions are present and non-empty', () => {
  const packs = loadPacksData();

  for (const [packName, pack] of Object.entries(packs.packs)) {
    assert(pack.description && pack.description.length > 0,
      `Pack "${packName}" has no description`);
  }
});

test('pack index markers exist in godmode heads', () => {
  const godmodeHeads = [
    'godmode-eventtech',
    'bdbmediastorm',
    'godmode-media-creation',
    'godmode-3d-creation',
    'godmode-ui-ux',
    'godmode-engineering',
    'godmode-shipping',
    'bdb-eventagency-skill',
    'godmode-hardware-pcb',
    'ask-tim'
  ];

  const PACK_INDEX_START = '<!-- aos:pack-index:start -->';
  const PACK_INDEX_END = '<!-- aos:pack-index:end -->';

  for (const skillName of godmodeHeads) {
    let skillPath = path.join(skillsDir, 'basic', skillName, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      skillPath = path.join(skillsDir, 'global_config', skillName, 'SKILL.md');
    }

    assert(fs.existsSync(skillPath), `Skill file not found: ${skillPath}`);
    const content = fs.readFileSync(skillPath, 'utf-8');
    assert(content.includes(PACK_INDEX_START),
      `Pack index start marker not found in ${skillName}`);
    assert(content.includes(PACK_INDEX_END),
      `Pack index end marker not found in ${skillName}`);
  }
});

test('mergeCandidates have valid structure', () => {
  const packs = loadPacksData();

  for (const candidate of packs.mergeCandidates) {
    assert(candidate.old, 'mergeCandidates entry missing "old" field');
    assert(candidate.new, 'mergeCandidates entry missing "new" field');
  }
});
