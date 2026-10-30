const fs = require('fs');
let code = fs.readFileSync('lib/lean-skills.js', 'utf8');

code = code.replace(
    /if \(sub === 'groups' && !groups\.length\) { write\('aos skills groups <a,b>: name at least one group\.\\n'\); return 2; }/,
    `if (sub === 'groups' && !groups.length) {
        write('aos skills groups <a,b>\\nAvailable groups:\\n');
        for (const [g, skills] of Object.entries(gm).sort()) {
            write(\`  \${g} (\${skills.length} skills, ~\${tokensFor(skills.length).toLocaleString()} tokens)\\n\`);
        }
        return 2;
    }`
);

fs.writeFileSync('lib/lean-skills.js', code);
