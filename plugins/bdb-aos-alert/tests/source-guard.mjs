import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../hooks/register.tsx', import.meta.url), 'utf8')
const fail = msg => {
  console.error(`source-guard: ${msg}`)
  process.exit(1)
}

for (const banned of ['prompt.submit', 'prompt.fill', 'fs.write', '$.http', '.aos/gate', '<Button']) {
  if (src.includes(banned)) fail(`${banned} is forbidden`)
}
if (/\b(?:const|let|var)\s+on\b|[(,]\s*on\s*=>/.test(src.replace('export const register: Register = on =>', ''))) {
  fail('a variable named on shadows the hook function')
}
console.log('source-guard: ok')
