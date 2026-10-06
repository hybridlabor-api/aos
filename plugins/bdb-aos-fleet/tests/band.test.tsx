import { expect, test } from 'claude-code/testing'

const SESSION = {
  id: 'a1',
  name: 'TASK MANAGER',
  role: 'task-manager',
  activity: 'attention',
  reason: 'GO: git push',
  repo: 'aos',
  branch: 'main',
  cwd: '/x',
  updatedAt: Date.now(),
}

test('the band draws every reporting session', async ($, on) => {
  on('env.get', () => ({ value: '/home' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({ value: [{ name: 'a1.json', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', () => ({ value: JSON.stringify(SESSION) }))
  on('clock.now', () => ({ value: SESSION.updatedAt + 1000 }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  await $.command.run({ command: 'aos-fleet', args: '' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'bdb-aos-fleet',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as never,
    })
    expect(JSON.stringify(await ui.drawn())).toContain('TASK MANAGER')
    expect(JSON.stringify(await ui.drawn())).toContain('GO: git push')
  }

  const pane = await $.ui.mount({
    plugin: 'bdb-aos-fleet',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'aos-fleet',
    props: { bodyColumns: 80 } as never,
  })
  expect(await pane.findAll({ type: 'Raster' })).toHaveLength(1)
})
