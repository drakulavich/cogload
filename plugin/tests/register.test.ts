import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const NOW = Date.parse('2026-10-03T10:00:00.000Z')
const SURFACES = ['terminal', 'desktop'] as const
const ENGINE_BAND = 'engine band'

const line = (fields: Record<string, unknown> = {}): string =>
  `${JSON.stringify({
    schema: 1,
    asOf: '2026-10-03T09:59:30.000Z',
    date: '2026-10-03',
    hour: 9,
    index: 68,
    level: 'Heating',
    peak: 81,
    activeMin: 375,
    streakMin: 160,
    ...fields,
  })}\n`

type Answer = { exitCode: number; stdout: string; stderr?: string }
type Run = Partial<Answer> | 'not found' | 'timeout' | Promise<Answer>

let clock: ReturnType<typeof mock.clock>

// The engine beneath the plugin: each queued answer is one `zapara status` run.
const engine = (on: On, runs: Run[], logs: string[] = []) => {
  clock = mock.clock(on, { now: NOW })
  on('session.start', () => ({ cwd: '/' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.log', (_$, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: ENGINE_BAND })
  })
  on('process.run', async (_$, e) => {
    expect(e.argv).toEqual(['zapara', 'status'])
    const run = runs.shift()
    if (run === undefined || run === 'not found') return { deny: 'zapara: command not found' }
    if (run === 'timeout') {
      await clock.advance(10_000)
      return { deny: 'zapara: still running' }
    }
    return {
      value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...(await run) },
    }
  })
}

// The plugin's run outlives the hook, so each helper lets it settle.
const start = async ($: Engine) => {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
}
const turnOnly = ($: Engine) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
const turn = async ($: Engine) => {
  await turnOnly($)
  await clock.advance(0)
}

const mount = ($: Engine, props: { bodyColumns?: number; hasSurvey?: boolean } = {}, surface: (typeof SURFACES)[number] = 'terminal') =>
  $.ui.mount({
    plugin: 'cognitive-load',
    surface,
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 3,
      bodyColumns: 100,
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
      ...props,
    },
  })

const band = async (...args: Parameters<typeof mount>) => {
  const texts = await (await mount(...args)).findAll({ type: 'Text' })
  return texts.map(t => t.text).join('')
}

describe('reading', () => {
  for (const surface of SURFACES) {
    test(`draws the full line after session.start (${surface})`, async ($, on) => {
      engine(on, [{ stdout: line() }])
      await start($)
      expect(await band($, {}, surface)).toBe('▓ Heating 68 · peak 81 · streak 2h40 · active 6h15')
    })
  }

  test('a later turn replaces the reading', async ($, on) => {
    engine(on, [{ stdout: line() }, { stdout: line({ index: 70 }) }])
    await start($)
    await turn($)
    expect(await band($)).toContain('Heating 70')
  })

  test('a failed run keeps the last good reading', async ($, on) => {
    const logs: string[] = []
    engine(on, [{ stdout: line() }, { exitCode: 1 }], logs)
    await start($)
    await turn($)
    expect(await band($)).toContain('Heating 68')
    expect(logs).toEqual(['exit 1'])
  })

  test('a failed first run draws no band', async ($, on) => {
    engine(on, [{ exitCode: 1 }])
    await start($)
    expect(await band($)).toBe(ENGINE_BAND)
  })

  for (const [name, stdout] of [
    ['schema 2', line({ schema: 2 })],
    ['broken JSON', '{'],
    ['a level without an index', line({ index: null, level: 'Calm' })],
    ['an index out of range', line({ index: 101 })],
    ['asOf two minutes ahead', line({ asOf: '2026-10-03T10:02:00.000Z' })],
    ['asOf without an instant timezone', line({ asOf: '2026-10-03' })],
    ['two lines', `warning\n${line()}`],
  ] as const) {
    test(`rejects ${name}`, async ($, on) => {
      const logs: string[] = []
      engine(on, [{ stdout }], logs)
      await start($)
      expect(await band($)).toBe(ENGINE_BAND)
      expect(logs).toEqual(['bad line'])
    })
  }

  test('accepts asOf less than a minute ahead', async ($, on) => {
    engine(on, [{ stdout: line({ asOf: '2026-10-03T10:00:30.000Z' }) }])
    await start($)
    expect(await band($)).toContain('Heating 68')
  })

  test('a run that cannot start draws no band, and a later good run does', async ($, on) => {
    const logs: string[] = []
    engine(on, ['not found', { stdout: line() }], logs)
    await start($)
    expect(await band($)).toBe(ENGINE_BAND)
    await turn($)
    expect(await band($)).toContain('Heating 68')
    expect(logs).toEqual(['not found'])
  })

  test('the run that finishes last wins', async ($, on) => {
    let finishFirst: (r: Answer) => void = () => {}
    const first = new Promise<Answer>(resolve => {
      finishFirst = resolve
    })
    engine(on, [{ stdout: line() }, first, { stdout: line({ index: 71 }) }])
    await start($)
    await turnOnly($)
    await turn($)
    finishFirst({ exitCode: 0, stdout: line({ index: 69 }) })
    await clock.advance(0)
    expect(await band($)).toContain('Heating 69')
  })

  test('a run that never ends does not hold the turn', async ($, on) => {
    engine(on, [{ stdout: line() }, new Promise<Answer>(() => {})])
    await start($)
    expect(await turnOnly($)).toEqual({ text: '' })
    expect(await band($)).toContain('Heating 68')
  })

  test('a run that hits the timeout logs timeout', async ($, on) => {
    const logs: string[] = []
    engine(on, ['timeout'], logs)
    await start($)
    await clock.advance(0)
    expect(logs).toEqual(['timeout'])
  })

  test('never shows or logs stderr or stdout', async ($, on) => {
    const logs: string[] = []
    engine(on, [{ exitCode: 1, stdout: 'my prompt text', stderr: '/Users/secret/path' }], logs)
    await start($)
    for (const text of [await band($), ...logs]) {
      expect(text).not.toContain('/Users/secret')
      expect(text).not.toContain('my prompt')
    }
  })
})

describe('band', () => {
  test('leaves out a zero streak', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 0 }) }])
    await start($)
    expect(await band($)).toBe('▓ Heating 68 · peak 81 · active 6h15')
  })

  test('formats minutes', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 45, activeMin: 1500 }) }, { stdout: line({ streakMin: 60, activeMin: 61 }) }])
    await start($)
    expect(await band($)).toBe('▓ Heating 68 · peak 81 · streak 45m · active 25h00')
    await turn($)
    expect(await band($)).toBe('▓ Heating 68 · peak 81 · streak 1h00 · active 1h01')
  })

  for (const surface of SURFACES) {
    test(`short form when narrow (${surface})`, async ($, on) => {
      engine(on, [{ stdout: line() }])
      await start($)
      expect(await band($, { bodyColumns: 40 }, surface)).toBe('▓ Heating 68')
    })

    test(`no band for a null index (${surface})`, async ($, on) => {
      engine(on, [{ stdout: line({ index: null, level: null }) }])
      await start($)
      expect(await band($, {}, surface)).toBe(ENGINE_BAND)
    })
  }

  test('no band before a reading', async ($, on) => {
    engine(on, [])
    expect(await band($)).toBe(ENGINE_BAND)
  })

  test('no band under a survey', async ($, on) => {
    engine(on, [{ stdout: line() }])
    await start($)
    expect(await band($, { hasSurvey: true })).toBe(ENGINE_BAND)
  })

  for (const [level, glyph, color] of [
    ['Calm', '░', 'green'],
    ['Warming', '▒', 'yellow'],
    ['Heating', '▓', 'magenta'],
    ['Fried', '█', 'red'],
  ] as const) {
    test(`${level} is ${glyph} in ${color}`, async ($, on) => {
      engine(on, [{ stdout: line({ level, index: 50 }) }])
      await start($)
      const ui = await mount($)
      expect(await ui.find({ type: 'Text', text: `${glyph} ${level} 50` })).toMatchObject({ props: { color } })
    })
  }
})
