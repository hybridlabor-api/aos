import { expect, test } from 'claude-code/testing'
import { getHomeDir } from '../hooks/home'
import type { EngineInterface } from 'claude-code'

test('getHomeDir returns HOME if set', async ($, on) => {
  on('env.get', (_$: any, e: { name: string }) => {
    if (e.name === 'HOME') return { value: '/custom/home' }
    return { value: undefined }
  })
  const res = await getHomeDir($ as unknown as EngineInterface)
  expect(res).toBe('/custom/home')
})

test('getHomeDir falls back to USERPROFILE if HOME is not set', async ($, on) => {
  on('env.get', (_$: any, e: { name: string }) => {
    if (e.name === 'HOME') return { value: undefined }
    if (e.name === 'USERPROFILE') return { value: 'C:\\Users\\Bob' }
    return { value: undefined }
  })
  const res = await getHomeDir($ as unknown as EngineInterface)
  expect(res).toBe('C:\\Users\\Bob')
})

test('getHomeDir falls back to HOMEDRIVE+HOMEPATH if USERPROFILE is not set', async ($, on) => {
  on('env.get', (_$: any, e: { name: string }) => {
    if (e.name === 'HOME') return { value: undefined }
    if (e.name === 'USERPROFILE') return { value: undefined }
    if (e.name === 'HOMEDRIVE') return { value: 'D:' }
    if (e.name === 'HOMEPATH') return { value: '\\Users\\Alice' }
    return { value: undefined }
  })
  const res = await getHomeDir($ as unknown as EngineInterface)
  expect(res).toBe('D:\\Users\\Alice')
})

test('getHomeDir handles missing env silently', async ($, on) => {
  on('env.get', () => { throw new Error('not found') })
  const res = await getHomeDir($ as unknown as EngineInterface)
  expect(res).toBe('')
})
