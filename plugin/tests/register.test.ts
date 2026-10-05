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
    streakMin: 20,
    ...fields,
  })}\n`

const live =
  (start: () => number, fields: Record<string, unknown> = {}) =>
  (): Partial<Answer> => ({
    stdout: line({ asOf: new Date(clock.now()).toISOString(), streakMin: Math.floor((clock.now() - start()) / 60_000), ...fields }),
  })

type Answer = { exitCode: number; stdout: string; stderr?: string }
type Run = Partial<Answer> | 'not found' | 'timeout' | Promise<Answer> | (() => Partial<Answer>)

let clock: ReturnType<typeof mock.clock>
let runCount = 0

// The engine beneath the plugin: each queued answer is one `zapara status` run.
const engine = (on: On, runs: Run[], logs: string[] = [], toasts: string[] = [], store: Record<string, unknown> = {}) => {
  clock = mock.clock(on, { now: NOW })
  runCount = 0
  mock.store(on, store)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
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
    runCount++
    const run = typeof runs[0] === 'function' ? runs[0]() : runs.shift()
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
      expect(await band($, {}, surface)).toBe('▓ Heating 68 · peak 81 · streak 20m · active 6h15')
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
    engine(on, [{ stdout: line({ streakMin: 39, activeMin: 1500 }) }, { stdout: line({ streakMin: 5, activeMin: 61 }) }])
    await start($)
    expect(await band($)).toBe('▓ Heating 68 · peak 81 · streak 39m · active 25h00')
    await turn($)
    expect(await band($)).toBe('▓ Heating 68 · peak 81 · streak 5m · active 1h01')
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

  for (const surface of SURFACES) {
    test(`no band while Calm (${surface})`, async ($, on) => {
      engine(on, [{ stdout: line({ level: 'Calm', index: 20 }) }])
      await start($)
      expect(await band($, {}, surface)).toBe(ENGINE_BAND)
    })
  }

  for (const [level, glyph, color] of [
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

const REST_MS = 10 * 60_000
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const DROP = (until: number, left: number) => ({
  drop: `Rest until ${hhmm(until)} (${left} min). Start with "override: <reason>" to go on.`,
})
const typed = ($: Engine, text: string, kind: 'composer' | 'bridge' = 'composer') =>
  $.prompt.submit({ text, wait: false, origin: { kind } })

describe('rest', () => {
  test('a 40-minute streak starts a rest of ten minutes, with one toast', async ($, on) => {
    const toasts: string[] = []
    engine(on, [{ stdout: line({ streakMin: 40 }) }], [], toasts)
    await start($)
    expect(await typed($, 'next')).toEqual(DROP(NOW + REST_MS, 10))
    expect(toasts).toEqual([`Rest until ${hhmm(NOW + REST_MS)}. Streak 40m, Heating 68.`])
  })

  test('a 39-minute Warming streak does not', async ($, on) => {
    const toasts: string[] = []
    engine(on, [{ stdout: line({ streakMin: 39, level: 'Warming', index: 50 }) }], [], toasts)
    await start($)
    expect(await typed($, 'next')).toEqual({ text: 'next' })
    expect(toasts).toEqual([])
  })

  test('a Fried reading starts a rest whatever the streak', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 5, level: 'Fried', index: 90 }) }])
    await start($)
    expect(await typed($, 'next')).toEqual(DROP(NOW + REST_MS, 10))
  })

  for (const kind of ['composer', 'bridge'] as const) {
    test(`a ${kind} prompt during a rest is dropped with the time`, async ($, on) => {
      engine(on, [{ stdout: line({ streakMin: 40 }) }])
      await start($)
      await clock.advance(3 * 60_000)
      expect(await typed($, 'next task', kind)).toEqual(DROP(NOW + REST_MS, 7))
    })
  }

  test('a composer prompt dropped by the rest goes back into the box', async ($, on) => {
    const fills: unknown[] = []
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    on('prompt.fill', (_$, e) => {
      fills.push({ text: e.text, mode: e.mode })
      return { isFilled: true }
    })
    await start($)
    await typed($, 'next task\nand more')
    await clock.advance(0)
    expect(fills).toEqual([{ text: 'next task\nand more', mode: 'replace' }])
  })

  for (const [what, prompt] of [
    ['a bridge prompt', ($: Engine) => typed($, 'next task', 'bridge')],
    ['an override', ($: Engine) => typed($, 'override: prod is down')],
  ] as const) {
    test(`${what} does not fill the box`, async ($, on) => {
      const fills: string[] = []
      engine(on, [{ stdout: line({ streakMin: 40 }) }])
      on('prompt.fill', (_$, e) => {
        fills.push(e.text)
        return { isFilled: true }
      })
      await start($)
      await prompt($)
      await clock.advance(0)
      expect(fills).toEqual([])
    })
  }

  for (const origin of [
    { kind: 'peer' },
    { kind: 'task-notification' },
    { kind: 'scheduled-trigger' },
    { kind: 'plugin', name: 'other' },
  ] as const) {
    test(`a ${origin.kind} prompt during a rest passes`, async ($, on) => {
      engine(on, [{ stdout: line({ streakMin: 40 }) }])
      await start($)
      expect(await $.prompt.submit({ text: 'report', wait: false, origin })).toEqual({ text: 'report' })
    })
  }

  test('after the rest a prompt passes', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    await clock.advance(REST_MS + 1000)
    expect(await typed($, 'next task')).toEqual({ text: 'next task' })
  })

  test('a streak rests once; a new streak rests again', async ($, on) => {
    const toasts: string[] = []
    let streakStart = NOW - 40 * 60_000
    engine(on, [live(() => streakStart)], [], toasts)
    await start($)
    await clock.advance(15 * 60_000)
    expect(toasts).toHaveLength(1)
    expect(await typed($, 'go')).toEqual({ text: 'go' })
    streakStart = clock.now() - 40 * 60_000
    await clock.advance(60_000)
    expect(toasts).toHaveLength(2)
    expect(await typed($, 'next')).toEqual(DROP(clock.now() + REST_MS, 10))
  })

  for (const [columns, surface] of [
    [120, 'terminal'],
    [40, 'desktop'],
  ] as const) {
    test(`the band says when the rest ends (${columns} columns)`, async ($, on) => {
      engine(on, [{ stdout: line({ streakMin: 40 }) }])
      await start($)
      expect(await band($, { bodyColumns: columns }, surface)).toBe(`▓ Heating 68 · rest until ${hhmm(NOW + REST_MS)} (10 min)`)
    })
  }

  test('a rest draws the band while Calm', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 45, level: 'Calm', index: 20 }) }])
    await start($)
    expect(await band($)).toBe(`░ Calm 20 · rest until ${hhmm(NOW + REST_MS)} (10 min)`)
  })
})

const DAY_MS = 24 * 60 * 60_000

describe('override', () => {
  test('a reason of three words lifts the rest and sends the rest of the prompt', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    expect(await typed($, 'override: prod is down\nfix the hotfix')).toEqual({ text: 'fix the hotfix' })
    expect(await typed($, 'next')).toEqual({ text: 'next' })
    expect(await band($)).toBe('▓ Heating 68 · peak 81 · streak 40m · active 6h15 · overrides this week: 1')
  })

  test('a reason of one word does not', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    expect(await typed($, 'override: ok\nfix it')).toEqual(DROP(NOW + REST_MS, 10))
  })

  test('an override alone lifts the rest and sends nothing', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    expect(await typed($, 'override: prod is down')).toEqual({ drop: 'Rest lifted.' })
    expect(await typed($, 'next')).toEqual({ text: 'next' })
  })

  test('the band counts the overrides of the last seven days', async ($, on) => {
    engine(on, [{ stdout: line() }], [], [], {
      overrides: [
        { at: NOW - 8 * DAY_MS, reason: 'old one here' },
        { at: NOW - 6 * DAY_MS, reason: 'deploy went wrong' },
        { at: NOW - DAY_MS, reason: 'prod is down' },
      ],
    })
    await start($)
    expect(await band($, { bodyColumns: 40 })).toBe('▓ Heating 68 · overrides this week: 2')
  })

  test('no count with none in seven days', async ($, on) => {
    engine(on, [{ stdout: line() }], [], [], { overrides: [{ at: NOW - 8 * DAY_MS, reason: 'old one here' }] })
    await start($)
    expect(await band($, { bodyColumns: 40 })).toBe('▓ Heating 68')
  })
})

const when = (ms: number) => {
  const [weekday, month, day] = new Date(ms).toDateString().split(' ')
  return `${weekday} ${day} ${month} ${hhmm(ms)}`
}

describe('/overrides', () => {
  test('lists the last 14 days, newest first, with reasons', async ($, on) => {
    engine(on, [], [], [], {
      overrides: [
        { at: NOW - 15 * DAY_MS, reason: 'too old to list' },
        { at: NOW - 9 * DAY_MS, reason: 'deploy went wrong' },
        { at: NOW - 2 * DAY_MS, reason: 'prod is down, fixing it' },
      ],
    })
    await start($)
    expect(await $.command.run({ command: 'overrides' })).toEqual({
      text: `${when(NOW - 2 * DAY_MS)}  prod is down, fixing it\n${when(NOW - 9 * DAY_MS)}  deploy went wrong`,
    })
  })

  test('says so when there are none', async ($, on) => {
    engine(on, [])
    await start($)
    expect(await $.command.run({ command: 'overrides' })).toEqual({ text: 'No overrides in 14 days.' })
  })
})

describe('every minute', () => {
  test('a streak that reaches 40 minutes between turns starts a rest', async ($, on) => {
    const toasts: string[] = []
    engine(on, [live(() => NOW - 39 * 60_000)], [], toasts)
    await start($)
    expect(await typed($, 'first')).toEqual({ text: 'first' })
    await clock.advance(60_000)
    expect(toasts).toHaveLength(1)
    expect(await typed($, 'next')).toEqual(DROP(NOW + 60_000 + REST_MS, 10))
  })

  test('the band counts down the rest', async ($, on) => {
    engine(on, [live(() => NOW - 40 * 60_000)])
    await start($)
    expect(await band($)).toBe(`▓ Heating 68 · rest until ${hhmm(NOW + REST_MS)} (10 min)`)
    await clock.advance(3 * 60_000)
    expect(await band($)).toBe(`▓ Heating 68 · rest until ${hhmm(NOW + REST_MS)} (7 min)`)
  })

  test('the band drops the rest once it is over', async ($, on) => {
    engine(on, [live(() => NOW - 40 * 60_000)])
    await start($)
    await clock.advance(REST_MS + 60_000)
    expect(await band($)).not.toContain('rest until')
  })

  test('a tick takes a reading under a minute old instead of running zapara', async ($, on) => {
    engine(on, [live(() => NOW - 20 * 60_000)])
    await start($)
    await clock.advance(30_000)
    await turn($)
    expect(runCount).toBe(2)
    await clock.advance(30_000)
    expect(runCount).toBe(2)
    await clock.advance(60_000)
    expect(runCount).toBe(3)
  })

  test('a tick runs zapara when no reading is stored', async ($, on) => {
    engine(on, ['not found', live(() => NOW - 20 * 60_000)])
    await start($)
    expect(runCount).toBe(1)
    await clock.advance(60_000)
    expect(runCount).toBe(2)
  })
})
