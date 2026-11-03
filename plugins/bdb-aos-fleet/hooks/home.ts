import type { EngineInterface } from 'claude-code'

export async function getHomeDir($: EngineInterface): Promise<string> {
  const home = await $.env.get('HOME').catch(() => '')
  if (home) return home
  const userProfile = await $.env.get('USERPROFILE').catch(() => '')
  if (userProfile) return userProfile
  const homeDrive = await $.env.get('HOMEDRIVE').catch(() => '')
  const homePath = await $.env.get('HOMEPATH').catch(() => '')
  if (homeDrive && homePath) return `${homeDrive}${homePath}`
  return ''
}
