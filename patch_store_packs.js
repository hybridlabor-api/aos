const fs = require('fs');
let code = fs.readFileSync('lib/store-packs.mjs', 'utf8');

code = code.replace(
    /export const knownPack = \(x\) => typeof x === 'string' && packNames\(\)\.includes\(x\);/,
    `export const knownPack = (x) => {
  if (typeof x !== 'string') return false;
  const packs = def().packs || {};
  if (packs[x]) return true;
  for (const p of Object.values(packs)) {
    if (p.aliases && p.aliases.includes(x)) return true;
  }
  return false;
};`
);

code = code.replace(
    /export function packSkillNames\(name\) {/,
    `export function packSkillNames(name) {
  const packs = def().packs || {};
  let resolvedName = name;
  if (!packs[name]) {
    for (const [k, p] of Object.entries(packs)) {
      if (p.aliases && p.aliases.includes(name)) resolvedName = k;
    }
  }`
);

code = code.replace(
    /const def = \(def\(\)\.packs \|\| \{\}\)\[name\];/,
    `const packDef = packs[resolvedName];`
);
code = code.replace(
    /if \(!def\) return \[\];/,
    `if (!packDef) return [];`
);
code = code.replace(
    /if \(Array\.isArray\(def\.skills\)\) return \[\.\.\.def\.skills\];/,
    `if (Array.isArray(packDef.skills)) return [...packDef.skills];`
);
code = code.replace(
    /if \(def\.groups && typeof def\.groups === 'object'\) return \[\.\.\.new Set\(Object\.values\(def\.groups\)\.flat\(\)\)\];/,
    `if (packDef.groups && typeof packDef.groups === 'object') return [...new Set(Object.values(packDef.groups).flat())];`
);

fs.writeFileSync('lib/store-packs.mjs', code);
