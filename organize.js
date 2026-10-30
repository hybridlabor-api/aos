const { readFileSync, writeFileSync } = require('fs');

const skillPacksPath = 'lib/skill-packs.json';
const packs = JSON.parse(readFileSync(skillPacksPath, 'utf8'));

// Find missing skills
const missingSkills = [
  'bdb-memb-mcp',
  'factory-babysit-pr',
  'factory-collect',
  'factory-human-digest',
  'factory-lookback',
  'factory-recover',
  'factory-review-prs',
  'factory-ship',
  'factory-watchdog',
  'git-advanced-workflows',
  'git-pr-review',
  'pb-aos-e2e',
  'pb-tauri-e2e'
];

// Reorganize into domains
const newPacks = {
  'engineering': {
    domain: 'engineering',
    description: 'Backend, Architecture & Deployment: testing, debugging, CI/CD, security, shipping',
    aliases: ['app-dev', 'stacks', 'agents-automation'],
    skills: []
  },
  'design-ui-ux': {
    domain: 'design-ui-ux',
    description: 'Design & Frontend: React, Next.js, TailwindCSS, UI components, accessibility',
    aliases: ['web-design'],
    skills: []
  },
  'media-eventtech': {
    domain: 'media-eventtech',
    description: 'Event & Live Tech, Motion, Content, 3D & Video',
    aliases: ['live-show', 'creator'],
    skills: []
  },
  'ops': {
    domain: 'ops',
    description: 'Agentur & Business: project management, research, automation, APIs, automation',
    aliases: ['business'],
    skills: []
  },
  'docs': {
    domain: 'docs',
    description: 'Harness Configuration & AOS Engineering: skills, memory, state, documentation',
    aliases: ['harness-engineering'],
    skills: []
  },
  'video': {
    domain: 'video',
    description: 'Video creation and rendering: routes, engines and handoffs',
    skills: []
  },
  'hardware': {
    domain: 'hardware',
    description: 'Hardware & PCB: KiCad, schematics, layouts, DRC, manufacturing (external skills)',
    external: true,
    skills: []
  }
};

const domainMapping = {
  'app-dev': 'engineering',
  'stacks': 'engineering',
  'agents-automation': 'engineering',
  'web-design': 'design-ui-ux',
  'live-show': 'media-eventtech',
  'creator': 'media-eventtech',
  'business': 'ops',
  'harness-engineering': 'docs',
  'hardware': 'hardware',
  'video': 'video'
};

for (const [oldName, oldPack] of Object.entries(packs.packs)) {
  const newDomain = domainMapping[oldName];
  if (!newDomain) throw new Error('Unknown old pack name ' + oldName);
  const targetPack = newPacks[newDomain];
  const oldSkills = oldPack.groups ? Object.values(oldPack.groups).flat() : oldPack.skills;
  targetPack.skills.push(...oldSkills);
}

const fs = require('fs');
const path = require('path');
const catToDomain = {
  'bdb-core': 'docs',
  'engineering-method': 'engineering',
  'library': 'engineering'
};

for (const s of missingSkills) {
  let found = false;
  const scanDir = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      if (fs.statSync(fullPath).isDirectory()) {
         if (item === s) {
            const content = fs.readFileSync(path.join(fullPath, 'SKILL.md'), 'utf8');
            const match = content.match(/^category:\s*['"]?([A-Za-z0-9_-]+)/m);
            const cat = match ? match[1] : 'none';
            found = cat;
         }
      }
    }
  };
  scanDir(path.join('skills', 'basic'));
  scanDir(path.join('skills', 'global_config'));
  fs.readdirSync('skills').forEach(item => {
    const fullPath = path.join('skills', item);
    if (fs.statSync(fullPath).isDirectory() && item !== 'basic' && item !== 'global_config') {
      scanDir(path.join('skills', item));
    }
  });

  if (found) {
     const dom = catToDomain[found] || 'engineering';
     newPacks[dom].skills.push(s);
  }
}

packs.packs = newPacks;
writeFileSync('lib/skill-packs.json', JSON.stringify(packs, null, 2) + '\n');
