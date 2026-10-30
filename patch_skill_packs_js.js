const fs = require('fs');

let code = fs.readFileSync('lib/skill-packs.js', 'utf8');

code = code.replace(
    /const packNames = \(root\) => Object\.keys\(loadPacks\(root\)\.packs \|\| \{\}\);/,
    `const packNames = (root) => Object.keys(loadPacks(root).packs || {});`
);

code = code.replace(
    /const knownPack = \(x, root\) => typeof x === 'string' && packNames\(root\)\.includes\(x\);/,
    `const knownPack = (x, root) => {
    if (typeof x !== 'string') return false;
    const packs = loadPacks(root).packs || {};
    if (packs[x]) return true;
    for (const p of Object.values(packs)) {
        if (p.aliases && p.aliases.includes(x)) return true;
    }
    return false;
};`
);

code = code.replace(
    /function expandSelection\(names, root\) {[\s\S]*?return out;\n}/,
    `function expandSelection(names, root) {
    const packs = loadPacks(root).packs || {};
    const resolveAlias = (n) => {
        if (packs[n]) return n;
        for (const [k, p] of Object.entries(packs)) {
            if (p.aliases && p.aliases.includes(n)) return k;
        }
        return n;
    };
    const out = [];
    for (let n of names) {
        if (typeof n !== 'string' || !NAME_RE.test(n)) continue;
        n = resolveAlias(n);
        if (!out.includes(n)) out.push(n);
    }
    return out;
}`
);

code = code.replace(
    /function packSkillNames\(root, name\) {/,
    `function packSkillNames(root, name) {
    const packs = loadPacks(root).packs || {};
    let resolvedName = name;
    if (!packs[name]) {
        for (const [k, p] of Object.entries(packs)) {
            if (p.aliases && p.aliases.includes(name)) resolvedName = k;
        }
    }`
);
code = code.replace(
    /const p = \(loadPacks\(root\)\.packs \|\| \{\}\)\[name\];/,
    `const p = packs[resolvedName];`
);

fs.writeFileSync('lib/skill-packs.js', code);
