import { expect, test } from 'claude-code/testing'

test('loads', async ($, on) => {
  on('session.start', () => ({ cwd: '/' }))
  expect(await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })).toEqual({ cwd: '/' })
})
