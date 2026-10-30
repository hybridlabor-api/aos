const fs = require('fs');
let code = fs.readFileSync('bin/aos-store.mjs', 'utf8');
code = code.replace(
    /console\.log\(\`\$\{kind\}\\t\$\{name\}\\t\$\{item\.category\}\\t\$\{src\.label\}\\t\$\{item\.description\}\`\);/,
    `let group = item.category;
    try {
      const packsData = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../lib/skill-packs.json'), 'utf8'));
      group = Object.entries(packsData.packs).find(([_, p]) => p.skills && p.skills.includes(name) || p.groups && Object.values(p.groups).flat().includes(name))?.[0] || item.category;
    } catch { /* ignore */ }
    console.log(\`\${kind}\\t\${name}\\t\${group}\\t\${src.label}\\t\${item.description}\`);`
);
code = code.replace(
    /import \{ homedir \} from 'node:os';/,
    `import { homedir } from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);`
);
fs.writeFileSync('bin/aos-store.mjs', code);
