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

// Every fillPreset call site must be a Button's onPress: no hook, timer or tool reaches the fill.
const callers = [...src.matchAll(/fillPreset\(/g)].length - 1
const viaButton = [...src.matchAll(/void fillPreset\(/g)].length
if (callers < 1) fail('expected at least one fillPreset caller')
if (callers !== viaButton) fail(`every fillPreset caller must be onPress={() => void fillPreset($, ...)}: ${callers} callers, ${viaButton} via onPress`)
if (!/onPress=\{\(\) => void fillPreset\(/.test(src)) fail('fillPreset must be called only from a Button onPress')
// The only file write is the heartbeat in publish(); the gate pane and the blocks list never write a file.
const writes = src.split('fs.write').length - 1
const pubStart = src.indexOf('async function publish(')
const pubEnd = src.indexOf('\n}\n', pubStart)
const w = src.indexOf('fs.write')
if (writes !== 1 || w < pubStart || w > pubEnd) fail('fs.write must appear once, inside publish')

// The gate pane draws itself; nothing may submit a prompt, and Button has no colour prop in this UI API.
for (const line of src.split('\n')) {
  const t = line.trim()
  if (t.includes('<Button') && /(?:^|[^.\w])color=/.test(t)) fail(`Button takes no color prop: ${t}`)
}
const planPane = src.slice(src.indexOf("requestId: PLAN_PANE"), src.indexOf('token-weather'))
if (planPane.includes('<Button')) fail('aos-plan pane must contain no <Button')
console.log('source-guard: ok')
