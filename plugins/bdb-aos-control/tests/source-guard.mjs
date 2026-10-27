import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../hooks/register.tsx', import.meta.url), 'utf8')
const fail = msg => {
  console.error(`source-guard: ${msg}`)
  process.exit(1)
}

if (src.includes('prompt.submit')) fail('prompt.submit is forbidden')
if (src.includes('.aos/gate')) fail('.aos/gate is forbidden')

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

const writes = src.split('fs.write').length - 1
if (writes !== 0) fail(`this mod must not write files; found ${writes} fs.write`)

for (const line of src.split('\n')) {
  const t = line.trim()
  if (t.includes('<Button') && /(?:^|[^.\w])color=/.test(t)) fail(`Button takes no color prop: ${t}`)
}

console.log('source-guard: ok')
