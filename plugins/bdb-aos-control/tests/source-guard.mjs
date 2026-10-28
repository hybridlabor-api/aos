import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../hooks/register.tsx', import.meta.url), 'utf8')
const lib = readFileSync(new URL('../hooks/lib.ts', import.meta.url), 'utf8')
// the pure helpers moved out of register.tsx: the forbidden-API checks cover them too
const logic = readFileSync(new URL('../hooks/logic.ts', import.meta.url), 'utf8')
const fail = msg => {
  console.error(`source-guard: ${msg}`)
  process.exit(1)
}

if ((src + logic).includes('prompt.submit')) fail('prompt.submit is forbidden')
if ((src + logic).includes('.aos/gate')) fail('.aos/gate is forbidden')

const fills = src.split('prompt.fill').length - 1
if (fills !== 1) fail(`expected exactly one prompt.fill, found ${fills}`)

const start = src.indexOf('async function fillPreset(')
const end = src.indexOf('\n}\n', start)
const at = src.indexOf('prompt.fill')
if (start < 0 || at < start || at > end) fail('prompt.fill must sit inside fillPreset')

const callers = [...src.matchAll(/fillPreset\(/g)].length - 1
const viaButton = [...src.matchAll(/void fillPreset\(/g)].length
if (callers < 1) fail('expected at least one fillPreset caller')
if (callers !== viaButton) fail(`every fillPreset caller must be onPress={() => void fillPreset($, ...)}: ${callers} callers, ${viaButton} via onPress`)
if (!/onPress=\{\(\) => void fillPreset\(/.test(src)) fail('fillPreset must be called only from a Button onPress')

const writes = (src + logic).split('fs.write').length - 1
if (writes !== 0) fail(`this mod must not write files; found ${writes} fs.write`)

for (const line of src.split('\n')) {
  const t = line.trim()
  if (t.includes('<Button') && /(?:^|[^.\w])color=/.test(t)) fail(`Button takes no color prop: ${t}`)
}

if (!/import type \{[^}]*\bControlTab\b[^}]*\} from '\.\.\/types'/s.test(src)) fail('ControlTab must be imported from ../types')
if (/\?\? 'soft'|mode: 'soft', grants: \[\], raw: ''\s*\}\)\)/.test(src + lib + logic)) fail('gate must not fall back to soft on error')
if (!/'Image' in ui/.test(src)) fail('logo image needs a capability check with text fallback')
if (!/redact\(/.test(src)) fail('fleet/pipeline text must pass through redact')
if (!/probeCache/.test(src)) fail('git probes must use the TTL cache')

console.log('source-guard: ok')

// every mod: `$` must never be handed to a function imported from another file (claude plugin validate rejects it)
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
const pluginsDir = new URL('../../', import.meta.url).pathname
const mods = readdirSync(pluginsDir).filter(d => d.startsWith('bdb-aos-') && statSync(join(pluginsDir, d, 'hooks'), { throwIfNoEntry: false })?.isDirectory())
for (const mod of ['bdb-aos-control', 'bdb-aos-fleet', 'bdb-aos-sessions', 'bdb-aos-alert']) {
  if (!mods.includes(mod)) fail(`mod ${mod} has no hooks dir`)
}
for (const mod of mods) {
  const dir = join(pluginsDir, mod, 'hooks')
  for (const f of readdirSync(dir).filter(n => /\.tsx?$/.test(n))) {
    const text = readFileSync(join(dir, f), 'utf8')
    const names = new Set()
    for (const m of text.matchAll(/import\s+(?!type\b)([^;'"]*?)\s+from\s+['"]\.{1,2}\/[^'"]*['"]/gs)) {
      for (const n of m[1].replace(/[{}]/g, ',').split(',')) {
        const id = n.trim().split(/\s+as\s+/).pop().replace(/^\*\s+as\s+/, '')
        if (/^[A-Za-z_]\w*$/.test(id)) names.add(id)
      }
    }
    for (const n of names) {
      if (new RegExp(`\\b${n}\\s*\\((?:[^()]*,)?\\s*\\$(?![\\w$])`).test(text)) fail(`${mod}/hooks/${f}: $ passed to imported ${n}()`)
    }
  }
}
console.log('source-guard: $ import guard ok')
