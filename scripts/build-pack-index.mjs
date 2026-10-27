#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packIndexPath = path.join(__dirname, '..', 'lib', 'skill-packs.json');
const skillsDir = path.join(__dirname, '..', 'skills');

const PACK_INDEX_START = '<!-- aos:pack-index:start -->';
const PACK_INDEX_END = '<!-- aos:pack-index:end -->';

// Map of godmode/head skills to their pack names
const godmodeHeads = {
  'godmode-eventtech': 'live-show',
  'bdbmediastorm': 'live-show',
  'godmode-media-creation': 'creator',
  'godmode-3d-creation': 'creator',
  'godmode-ui-ux': 'web-design',
  'godmode-engineering': ['app-dev', 'stacks', 'agents-automation'],
  'godmode-shipping': 'app-dev',
  'bdb-eventagency-skill': 'business',
  'godmode-hardware-pcb': 'hardware',
  'ask-tim': 'all'
};

function loadPacksData() {
  if (!fs.existsSync(packIndexPath)) {
    throw new Error(`Pack data not found: ${packIndexPath}`);
  }
  return JSON.parse(fs.readFileSync(packIndexPath, 'utf-8'));
}

let _skillsCache = null;
function getSkillMap() {
  if (_skillsCache) return _skillsCache;
  const map = {};

  function walkDir(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        const skillMd = path.join(p, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
          map[e.name] = skillMd;
        }
        walkDir(p);
      }
    }
  }

  walkDir(skillsDir);

  const vendorDir = path.join(__dirname, '..', 'vendor');
  if (fs.existsSync(vendorDir)) {
    for (const v of fs.readdirSync(vendorDir, { withFileTypes: true })) {
      if (!v.isDirectory()) continue;
      const vSkills = path.join(vendorDir, v.name, 'skills');
      walkDir(vSkills);
    }
  }

  _skillsCache = map;
  return map;
}

function getAllSkills() {
  const map = getSkillMap();
  const skills = {};
  for (const name of Object.keys(map)) {
    skills[name] = true;
  }
  return skills;
}

function readSkillDescription(skillName) {
  const map = getSkillMap();
  const loc = map[skillName];
  if (loc && fs.existsSync(loc)) {
    const content = fs.readFileSync(loc, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (match) {
      const frontmatter = match[1];
      const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
      if (descMatch) {
        return descMatch[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  }

  return '';
}

function generatePackIndex(packName, packs) {
  const pack = packs.packs[packName];
  if (!pack) return null;

  let lines = [];

  if (pack.groups) {
    // Stacks pack with groups
    for (const [group, skills] of Object.entries(pack.groups)) {
      lines.push(`### ${group.charAt(0).toUpperCase() + group.slice(1)}`);
      lines.push('');
      for (const skill of skills) {
        const desc = readSkillDescription(skill) || skill;
        lines.push(`- **${skill}** — ${desc}`);
      }
      lines.push('');
    }
  } else {
    // Regular pack
    for (const skill of pack.skills) {
      const desc = readSkillDescription(skill) || skill;
      lines.push(`- **${skill}** — ${desc}`);
    }
    lines.push('');
  }

  lines.push(`**Install:** \`aos store install --pack ${packName}\``);
  lines.push('');

  return lines.join('\n');
}

function generateAllPacksCatalogue(packs) {
  let lines = [];
  lines.push('## Available Packs');
  lines.push('');

  for (const [packName, pack] of Object.entries(packs.packs)) {
    lines.push(`### ${packName}`);
    lines.push('');
    lines.push(`${pack.description}`);
    lines.push('');
    lines.push(`**Install:** \`aos store install --pack ${packName}\``);
    lines.push('');
  }

  lines.push('## Roles (Preset Pack Combinations)');
  lines.push('');
  lines.push('- **Eventagentur / Veranstalter**: business, creator');
  lines.push('- **Event- und Live-Technik**: live-show, hardware, creator');
  lines.push('- **Motion- und Content-Design**: creator, web-design');
  lines.push('- **Web- und App-Entwicklung**: web-design, app-dev, stacks');
  lines.push('- **Agents und Automationen**: agents-automation, app-dev');
  lines.push('- **Harness-Engineering**: all packs');
  lines.push('');

  return lines.join('\n');
}

function updateSkillMd(skillPath, packName, packIndex, checkMode = false) {
  if (!fs.existsSync(skillPath)) {
    console.warn(`Skill file not found: ${skillPath}`);
    return false;
  }

  let content = fs.readFileSync(skillPath, 'utf-8');
  let startIdx = content.indexOf(PACK_INDEX_START);
  let endIdx = content.indexOf(PACK_INDEX_END);

  // If markers don't exist, add them at the end
  if (startIdx === -1 || endIdx === -1) {
    const sectionTitle = packName === 'all'
      ? 'Available Packs & Roles Catalogue'
      : `${packName.charAt(0).toUpperCase() + packName.slice(1).replace(/-/g, ' ')} Pack Skills`;

    const markerSection = `\n\n---\n\n## ${sectionTitle}\n\n${PACK_INDEX_START}\n${PACK_INDEX_END}\n`;
    content = content + markerSection;
    startIdx = content.indexOf(PACK_INDEX_START);
    endIdx = content.indexOf(PACK_INDEX_END);
  }

  const beforeStart = content.substring(0, startIdx + PACK_INDEX_START.length);
  // Find the LAST occurrence of end marker to handle duplicates
  const lastEndIdx = content.lastIndexOf(PACK_INDEX_END);
  const afterEnd = content.substring(lastEndIdx + PACK_INDEX_END.length);

  const newContent = beforeStart + '\n' + packIndex + PACK_INDEX_END + afterEnd;

  if (checkMode) {
    return content !== newContent;
  }

  fs.writeFileSync(skillPath, newContent, 'utf-8');
  return true;
}

function main(argv) {
  const checkMode = argv.includes('--check');
  const packs = loadPacksData();
  const allSkills = getAllSkills();

  // Validate: all listed skills exist
  const validateSkills = (skills, isExternal = false) => {
    for (const skill of skills) {
      if (!isExternal && !allSkills[skill]) {
        console.warn(`Warning: skill not found in skills/ directory: ${skill}`);
      }
    }
  };

  // Validate base
  validateSkills(packs.base);

  // Validate packs
  for (const [packName, pack] of Object.entries(packs.packs)) {
    if (pack.groups) {
      for (const skills of Object.values(pack.groups)) {
        validateSkills(skills, pack.external);
      }
    } else {
      validateSkills(pack.skills, pack.external);
    }
  }

  // Check: no skill in two packs
  const skillToPackMap = {};
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
        console.error(`Error: skill "${skill}" found in both "${skillToPackMap[skill]}" and "${packName}"`);
        process.exit(1);
      }
      skillToPackMap[skill] = packName;
    }
  }

  // Update godmode heads with pack indices
  const updated = [];
  const needsUpdate = [];

  for (const [skillName, packNames] of Object.entries(godmodeHeads)) {
    // try basic first, then global_config
    let skillPath = path.join(skillsDir, 'basic', skillName, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      skillPath = path.join(skillsDir, 'global_config', skillName, 'SKILL.md');
    }

    if (packNames === 'all') {
      // ask-tim gets all packs
      const packIndex = generateAllPacksCatalogue(packs);
      if (checkMode) {
        if (updateSkillMd(skillPath, 'all', packIndex, true)) {
          needsUpdate.push(skillName);
        }
      } else {
        if (updateSkillMd(skillPath, 'all', packIndex)) {
          updated.push(skillName);
        }
      }
    } else {
      const packs_array = Array.isArray(packNames) ? packNames : [packNames];
      let combinedIndex = '';
      for (const packName of packs_array) {
        const packIndex = generatePackIndex(packName, packs);
        if (packIndex) {
          if (packs_array.length > 1) {
            combinedIndex += `### ${packName.charAt(0).toUpperCase() + packName.slice(1).replace(/-/g, ' ')} Pack Skills\n\n${packIndex}\n\n`;
          } else {
            combinedIndex += packIndex;
          }
        }
      }
      const label = Array.isArray(packNames) ? packNames.join(', ') : packNames;
      if (checkMode) {
        if (updateSkillMd(skillPath, label, combinedIndex.trimEnd() + '\n', true)) {
          needsUpdate.push(skillName);
        }
      } else {
        if (updateSkillMd(skillPath, label, combinedIndex.trimEnd() + '\n')) {
          updated.push(skillName);
        }
      }
    }
  }

  if (checkMode) {
    if (needsUpdate.length > 0) {
      console.log('Files need update:');
      needsUpdate.forEach(f => console.log(`  ${f}`));
      process.exit(1);
    } else {
      console.log('All pack indices are up to date.');
    }
  } else {
    if (updated.length > 0) {
      console.log('Updated pack indices in:');
      updated.forEach(f => console.log(`  ${f}`));
    } else {
      console.log('No updates needed.');
    }
  }
}

main(process.argv.slice(2));
