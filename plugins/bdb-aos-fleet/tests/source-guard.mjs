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

// The only caller may be a Button's onPress: no hook, timer or tool reaches the fill.
const callers = [...src.matchAll(/fillPreset\(/g)].length - 1
if (callers !== 1) fail(`expected exactly one fillPreset caller, found ${callers}`)
if (!/onPress=\{\(\) => void fillPreset\(/.test(src)) fail('fillPreset must be called only from a Button onPress')
console.log('source-guard: ok')
