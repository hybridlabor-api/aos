const fs = require('fs');

let findSkillMd = fs.readFileSync('skills/global_config/find-skill/SKILL.md', 'utf8');
findSkillMd = findSkillMd.replace(
    /Output columns: kind, name, category, source, description\./,
    `Output columns: kind, name, pack/group, source, description.`
);
fs.writeFileSync('skills/global_config/find-skill/SKILL.md', findSkillMd);

let buildPackIndexMjs = fs.readFileSync('scripts/build-pack-index.mjs', 'utf8');
buildPackIndexMjs = buildPackIndexMjs.replace(
    /const godmodeHeads = \{[^}]+\};/,
    `const godmodeHeads = {
  'godmode-eventtech': 'media-eventtech',
  'bdbmediastorm': 'media-eventtech',
  'godmode-media-creation': 'media-eventtech',
  'godmode-3d-creation': 'media-eventtech',
  'godmode-ui-ux': 'design-ui-ux',
  'godmode-engineering': ['engineering'],
  'godmode-shipping': 'engineering',
  'bdb-eventagency-skill': 'ops',
  'godmode-hardware-pcb': 'hardware',
  'ask-tim': 'all'
};`
);
buildPackIndexMjs = buildPackIndexMjs.replace(
    /lines\.push\('- \*\*Eventagentur \/ Veranstalter\*\*: business, creator'\);[\s\S]*?lines\.push\('- \*\*Harness-Engineering\*\*: all packs'\);/,
    `lines.push('- **Eventagentur / Veranstalter**: ops, media-eventtech');
  lines.push('- **Event- und Live-Technik**: media-eventtech, hardware');
  lines.push('- **Motion- und Content-Design**: media-eventtech, design-ui-ux');
  lines.push('- **Web- und App-Entwicklung**: design-ui-ux, engineering');
  lines.push('- **Agents und Automationen**: engineering');
  lines.push('- **Harness-Engineering**: all packs');`
);
fs.writeFileSync('scripts/build-pack-index.mjs', buildPackIndexMjs);
