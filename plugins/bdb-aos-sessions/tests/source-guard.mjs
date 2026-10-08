import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../hooks/register.tsx', import.meta.url), 'utf8')
const fail = msg => {
  console.error(`source-guard: ${msg}`)
  process.exit(1)
}

if (src.includes('prompt.submit')) fail('prompt.submit is forbidden')
if (src.includes('prompt.fill')) fail('prompt.fill is forbidden')
if (src.includes('fs.write')) fail('fs.write is forbidden')
if (src.includes('.aos/gate')) fail('.aos/gate is forbidden')
if (src.includes('$.http')) fail('$.http is forbidden')
if (src.includes('<Button')) fail('<Button is forbidden')

console.log('source-guard: ok')
