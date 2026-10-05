import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const NOW = Date.parse('2026-10-03T10:00:00.000Z')
const SURFACES = ['terminal', 'desktop'] as const
const ENGINE_BAND = 'engine band'
const DAY_MS = 24 * 60 * 60_000
const ASOF = Date.parse('2026-10-03T09:59:30.000Z')

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
let commands: string[] = []
let todayRuns: Run[] = []

// The engine beneath the plugin: each queued answer is one `cogload status` run, or one `cogload today --json` from todayRuns.
const engine = (on: On, runs: Run[], logs: string[] = [], toasts: string[] = [], store: Record<string, unknown> = {}) => {
  clock = mock.clock(on, { now: NOW })
  runCount = 0
  commands = []
  todayRuns = []
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    delete store[e.key]
    return { value: undefined }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('command.register', (_$, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
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
    const isToday = e.argv[1] === 'today'
    expect(e.argv).toEqual(isToday ? ['cogload', 'today', '--json'] : ['cogload', 'status'])
    if (!isToday) runCount++
    const queue = isToday ? todayRuns : runs
    const run = typeof queue[0] === 'function' ? queue[0]() : queue.shift()
    if (run === undefined || run === 'not found') return { deny: 'cogload: command not found' }
    if (run === 'timeout') {
      await clock.advance(10_000)
      return { deny: 'cogload: still running' }
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
      expect(await band($, {}, surface)).toBe(`● Heating · streak 20m`)
    })
  }

  test('a later turn replaces the reading', async ($, on) => {
    engine(on, [{ stdout: line() }, { stdout: line({ streakMin: 25 }) }])
    await start($)
    await turn($)
    expect(await band($)).toBe('● Heating · streak 25m')
  })

  test('a failed run keeps the last good reading', async ($, on) => {
    const logs: string[] = []
    engine(on, [{ stdout: line() }, { exitCode: 1 }], logs)
    await start($)
    await turn($)
    expect(await band($)).toBe('● Heating · streak 20m')
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
    expect(await band($)).toBe('● Heating · streak 20m')
  })

  test('a run that cannot start draws no band, and a later good run does', async ($, on) => {
    const logs: string[] = []
    engine(on, ['not found', { stdout: line() }], logs)
    await start($)
    expect(await band($)).toBe(ENGINE_BAND)
    await turn($)
    expect(await band($)).toBe('● Heating · streak 20m')
    expect(logs).toEqual(['not found'])
  })

  test('the run that finishes last wins', async ($, on) => {
    let finishFirst: (r: Answer) => void = () => {}
    const first = new Promise<Answer>(resolve => {
      finishFirst = resolve
    })
    engine(on, [{ stdout: line() }, first, { stdout: line({ streakMin: 22 }) }])
    await start($)
    await turnOnly($)
    await turn($)
    finishFirst({ exitCode: 0, stdout: line({ streakMin: 21 }) })
    await clock.advance(0)
    expect(await band($)).toBe('● Heating · streak 21m')
  })

  test('a run that never ends does not hold the turn', async ($, on) => {
    engine(on, [{ stdout: line() }, new Promise<Answer>(() => {})])
    await start($)
    expect(await turnOnly($)).toEqual({ text: '' })
    expect(await band($)).toBe('● Heating · streak 20m')
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
    expect(await band($)).toBe('● Heating')
  })

  test('formats minutes', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 160 }) }, { stdout: line({ streakMin: 5 }) }], [], [], {
      spent: ASOF - 160 * 60_000,
    })
    await start($)
    expect(await band($)).toBe('● Heating · streak 2h40')
    await turn($)
    expect(await band($)).toBe('● Heating · streak 5m')
  })

  test('at 120 columns, the level and the streak', async ($, on) => {
    engine(on, [{ stdout: line() }])
    await start($)
    expect(await band($, { bodyColumns: 120 })).toBe('● Heating · streak 20m')
  })

  for (const columns of [40, 49, 50, 120]) {
    test(`no index, peak or active at ${columns} columns`, async ($, on) => {
      engine(on, [{ stdout: line({ index: 77, peak: 81, activeMin: 375 }) }])
      await start($)
      const text = await band($, { bodyColumns: columns })
      for (const gone of ['77', 'peak', 'active', '81', '6h15']) expect(text).not.toContain(gone)
    })
  }

  test('an override this week adds nothing to the band', async ($, on) => {
    engine(on, [{ stdout: line() }], [], [], { overrides: [{ at: NOW - DAY_MS, reason: 'prod is down' }] })
    await start($)
    expect(await band($, { bodyColumns: 120 })).toBe('● Heating · streak 20m')
  })

  for (const surface of SURFACES) {
    test(`short form when narrow (${surface})`, async ($, on) => {
      engine(on, [{ stdout: line() }])
      await start($)
      expect(await band($, { bodyColumns: 40 }, surface)).toBe(`● Heating`)
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

  test('Calm is success', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 37, level: 'Calm', index: 20 }) }])
    await start($)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: '● Calm' })).toMatchObject({ props: { color: 'success' } })
  })

  for (const [level, color] of [
    ['Warming', 'warning'],
    ['Heating', '#ff8700'],
    ['Fried', 'red'],
  ] as const) {
    test(`${level} is ${color}`, async ($, on) => {
      engine(on, [{ stdout: line({ level, index: 50 }) }])
      await start($)
      const ui = await mount($)
      expect(await ui.find({ type: 'Text', text: `● ${level}` })).toMatchObject({ props: { color } })
    })
  }

  test('only the level is coloured; the rest of the line is dim', async ($, on) => {
    engine(on, [{ stdout: line() }])
    await start($)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: '● Heating' })).toMatchObject({ props: { color: '#ff8700' } })
    const tail = await ui.find({ type: 'Text', text: ' · streak 20m' })
    expect(tail).toMatchObject({ props: { dimColor: true } })
    expect(tail?.props).not.toHaveProperty('color')
  })
})

const REST_MS = 10 * 60_000
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const HINT = ' To go on now, start the prompt with "override: <reason>".'
const DROP = (until: number, { kind = 'composer', hint = true }: { kind?: 'composer' | 'bridge'; hint?: boolean } = {}) => ({
  drop: `Rest until ${hhmm(until)}.${kind === 'composer' ? ' Your prompt is saved.' : ''}${hint ? HINT : ''}`,
})
const SHORT = 'An override needs a reason of three words or more.'
const typed = ($: Engine, text: string, kind: 'composer' | 'bridge' = 'composer') =>
  $.prompt.submit({ text, wait: false, origin: { kind } })

describe('rest', () => {
  test('a 40-minute streak starts a rest of ten minutes, with one toast', async ($, on) => {
    const toasts: string[] = []
    engine(on, [{ stdout: line({ streakMin: 40 }) }], [], toasts, { welcomed: true })
    await start($)
    expect(await typed($, 'next')).toEqual(DROP(NOW + REST_MS))
    expect(toasts).toEqual([`Rest until ${hhmm(NOW + REST_MS)}. Streak 40m, Heating 68.`])
  })

  test('a 39-minute Warming streak does not', async ($, on) => {
    const toasts: string[] = []
    engine(on, [{ stdout: line({ streakMin: 39, level: 'Warming', index: 50 }) }], [], toasts, { welcomed: true })
    await start($)
    expect(await typed($, 'next')).toEqual({ text: 'next' })
    expect(toasts).toEqual([])
  })

  test('a Fried reading starts a rest whatever the streak', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 5, level: 'Fried', index: 90 }) }])
    await start($)
    expect(await typed($, 'next')).toEqual(DROP(NOW + REST_MS))
  })

  test('a Fried reading at streak 37 starts the rest with no warning', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 37, level: 'Fried', index: 90 }) }])
    await start($)
    expect(await band($)).toBe(`● Fried · rest until ${hhmm(NOW + REST_MS)} (10 min)`)
  })

  test('a held composer prompt says it is saved, and the override only the first time', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    await clock.advance(3 * 60_000)
    expect(await typed($, 'next task')).toEqual(DROP(NOW + REST_MS))
    expect(await typed($, 'next task')).toEqual(DROP(NOW + REST_MS, { hint: false }))
  })

  test('a held bridge prompt says only the time, and the override the first time', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    expect(await typed($, 'next task', 'bridge')).toEqual(DROP(NOW + REST_MS, { kind: 'bridge' }))
    expect(await typed($, 'next task', 'bridge')).toEqual(DROP(NOW + REST_MS, { kind: 'bridge', hint: false }))
  })

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
    engine(on, [live(() => streakStart)], [], toasts, { welcomed: true })
    await start($)
    await clock.advance(15 * 60_000)
    expect(toasts).toHaveLength(1)
    expect(await typed($, 'go')).toEqual({ text: 'go' })
    streakStart = clock.now() - 40 * 60_000
    await clock.advance(60_000)
    expect(toasts).toHaveLength(2)
    expect(await typed($, 'next')).toEqual(DROP(clock.now() + REST_MS))
  })

  for (const [columns, surface] of [
    [120, 'terminal'],
    [40, 'desktop'],
  ] as const) {
    test(`the band says when the rest ends (${columns} columns)`, async ($, on) => {
      engine(on, [{ stdout: line({ streakMin: 40 }) }])
      await start($)
      expect(await band($, { bodyColumns: columns }, surface)).toBe(`● Heating · rest until ${hhmm(NOW + REST_MS)} (10 min)`)
    })
  }

  test('a rest draws the band while Calm', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 45, level: 'Calm', index: 20 }) }])
    await start($)
    expect(await band($)).toBe(`● Calm · rest until ${hhmm(NOW + REST_MS)} (10 min)`)
  })
})

describe('warning', () => {
  for (const [streakMin, expected] of [
    [35, '● Heating · rest in 5 min'],
    [39, '● Heating · rest in 1 min'],
    [34, '● Heating · streak 34m'],
  ] as const) {
    test(`streak ${streakMin}`, async ($, on) => {
      engine(on, [{ stdout: line({ streakMin }) }])
      await start($)
      expect(await band($)).toBe(expected)
    })
  }

  test('stays when narrow', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 37 }) }])
    await start($)
    expect(await band($, { bodyColumns: 40 })).toBe('● Heating · rest in 3 min')
  })

  test('draws the band while Calm', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 37, level: 'Calm', index: 20 }) }])
    await start($)
    expect(await band($)).toBe('● Calm · rest in 3 min')
  })

  for (const [what, offset] of [
    ['a streak that already held', 0],
    ['a streak that started five minutes before the last rest', 5 * 60_000],
  ] as const) {
    test(`none for ${what}`, async ($, on) => {
      engine(on, [{ stdout: line({ streakMin: 37 }) }], [], [], { spent: ASOF - 37 * 60_000 + offset })
      await start($)
      expect(await band($)).toBe('● Heating · streak 37m')
    })
  }

  test('the tick counts it down', async ($, on) => {
    engine(on, [live(() => NOW - 36 * 60_000)])
    await start($)
    expect(await band($)).toBe('● Heating · rest in 4 min')
    await clock.advance(60_000)
    expect(await band($)).toBe('● Heating · rest in 3 min')
  })
})

describe('override', () => {
  test('after the drop that taught it, an override lifts the rest and sends the second line', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    expect(await typed($, 'next')).toEqual(DROP(NOW + REST_MS))
    expect(await typed($, 'override: prod is down\nfix the hotfix')).toEqual({ text: 'fix the hotfix' })
    expect(await typed($, 'next')).toEqual({ text: 'next' })
  })

  test('a reason of three words lifts the rest and sends the rest of the prompt', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    expect(await typed($, 'override: prod is down\nfix the hotfix')).toEqual({ text: 'fix the hotfix' })
    expect(await typed($, 'next')).toEqual({ text: 'next' })
    expect(await band($)).toBe('● Heating · streak 40m')
  })

  for (const prompt of ['override: ok\nfix it', 'override:', 'override: prod down']) {
    test(`${JSON.stringify(prompt)} asks for a longer reason, goes back into the box and keeps the rest`, async ($, on) => {
      const fills: string[] = []
      engine(on, [{ stdout: line({ streakMin: 40 }) }])
      on('prompt.fill', (_$, e) => {
        fills.push(e.text)
        return { isFilled: true }
      })
      await start($)
      expect(await typed($, prompt)).toEqual({ drop: `${SHORT} Your prompt is saved.` })
      await clock.advance(0)
      expect(fills).toEqual([prompt])
      expect(await typed($, 'next', 'bridge')).toEqual(DROP(NOW + REST_MS, { kind: 'bridge' }))
    })
  }

  test('a short override from a bridge asks for a longer reason without saving', async ($, on) => {
    const fills: string[] = []
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    on('prompt.fill', (_$, e) => {
      fills.push(e.text)
      return { isFilled: true }
    })
    await start($)
    expect(await typed($, 'override: ok\nfix it', 'bridge')).toEqual({ drop: SHORT })
    await clock.advance(0)
    expect(fills).toEqual([])
  })

  test('a short override does not take the hint', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    expect(await typed($, 'override: ok')).toEqual({ drop: `${SHORT} Your prompt is saved.` })
    expect(await typed($, 'next')).toEqual(DROP(NOW + REST_MS))
    expect(await typed($, 'next')).toEqual(DROP(NOW + REST_MS, { hint: false }))
  })

  test('an override alone lifts the rest and sends nothing', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    expect(await typed($, 'override: prod is down')).toEqual({ drop: 'Rest lifted.' })
    expect(await typed($, 'next')).toEqual({ text: 'next' })
  })

})

describe('store', () => {
  test('a started rest adds its start to rests and drops one eight days old', async ($, on) => {
    const store: Record<string, unknown> = { rests: [NOW - 8 * DAY_MS, NOW - 6 * DAY_MS] }
    engine(on, [{ stdout: line({ streakMin: 40 }) }], [], [], store)
    await start($)
    expect(store.rests).toEqual([NOW - 6 * DAY_MS, NOW])
  })

  test('an override drops the ones older than seven days', async ($, on) => {
    const store: Record<string, unknown> = {
      overrides: [
        { at: NOW - 8 * DAY_MS, reason: 'old one here' },
        { at: NOW - 6 * DAY_MS, reason: 'deploy went wrong' },
      ],
    }
    engine(on, [{ stdout: line({ streakMin: 40 }) }], [], [], store)
    await start($)
    await typed($, 'override: prod is down')
    expect(store.overrides).toEqual([
      { at: NOW - 6 * DAY_MS, reason: 'deploy went wrong' },
      { at: NOW, reason: 'prod is down' },
    ])
  })

  test('/overrides is not registered', async ($, on) => {
    engine(on, [{ stdout: line() }])
    await start($)
    expect(commands).not.toContain('overrides')
  })
})

const METRICS = {
  sessions: 1,
  prompts: 0,
  reports: 0,
  outputTokens: 0,
  interrupts: 0,
  rejects: 0,
  questions: 0,
  plans: 0,
  modeSwitches: 0,
  decisions: 0,
  contextSwitches: 0,
  activeMin: 60,
  streakMin: 0,
  lateNight: false,
}
const NO_PARTS = { parallel: 0, pace: 0, supervision: 0, reading: 0, streak: 0, late: 0 }

// `cogload today --json`: the day, with `live` the last sixty minutes.
const today = (live: Record<string, unknown> | null, parts: Record<string, number> = {}, score = { index: 80, level: 'Heating' }) =>
  `${JSON.stringify({
    date: '2026-10-03',
    peak: 81,
    mean: 40,
    activeMin: 375,
    presence: null,
    buckets: [],
    asOf: '2026-10-03T09:59:30.000Z',
    live: live && { ...METRICS, ...live, score: { ...score, parts: { ...NO_PARTS, ...parts } } },
  })}\n`

const explain = async ($: Engine, on: On, answer: Run, store: Record<string, unknown> = {}) => {
  engine(on, [{ stdout: line() }], [], [], { welcomed: true, ...store })
  todayRuns = [answer]
  await start($)
  return (await $.command.run({ command: 'cogload' })).text
}

describe('/cogload', () => {
  for (const [part, points, metrics, phrase] of [
    ['parallel', 25, { sessions: 5 }, '5 sessions at once'],
    ['pace', 15, { prompts: 32 }, '32 prompts'],
    ['supervision', 30, { decisions: 16, contextSwitches: 13 }, '16 decisions and 13 context switches'],
    ['reading', 10, { outputTokens: 81_400 }, '81k output tokens'],
    ['streak', 10, { streakMin: 57 }, 'a 57m streak'],
    ['late', 10, { lateNight: true }, 'late at night'],
  ] as const) {
    test(`${part} alone at its cap`, async ($, on) => {
      expect(await explain($, on, { stdout: today(metrics, { [part]: points }) })).toBe(`Heating 80 this hour, at the cap: ${phrase}.`)
    })
  }

  test('parts at their cap come heaviest weight first', async ($, on) => {
    const stdout = today({ prompts: 32, decisions: 16, contextSwitches: 13, streakMin: 57 }, { streak: 10, pace: 15, supervision: 30 })
    expect(await explain($, on, { stdout })).toBe(
      'Heating 80 this hour, at the cap: 16 decisions and 13 context switches, 32 prompts, a 57m streak.',
    )
  })

  test('with none at its cap, the largest share of its weight', async ($, on) => {
    const stdout = today({ sessions: 4, decisions: 6, contextSwitches: 12 }, { parallel: 18.8, supervision: 20 }, { index: 45, level: 'Warming' })
    expect(await explain($, on, { stdout })).toBe('Warming 45 this hour, mostly 4 sessions at once.')
  })

  test('a tie on share goes to the heavier weight', async ($, on) => {
    const stdout = today({ prompts: 10, outputTokens: 40_000 }, { pace: 7.5, reading: 5 }, { index: 13, level: 'Calm' })
    expect(await explain($, on, { stdout })).toBe('Calm 13 this hour, mostly 10 prompts.')
  })

  test('no live hour', async ($, on) => {
    expect(await explain($, on, { stdout: today(null) })).toBe('Nothing scored this hour.')
  })

  test('a live hour with no score', async ($, on) => {
    expect(await explain($, on, { stdout: today(null).replace('"live":null', `"live":${JSON.stringify({ ...METRICS, score: null })}`) })).toBe(
      'Nothing scored this hour.',
    )
  })

  test("the week's rests and overrides, with the reason", async ($, on) => {
    const text = await explain($, on, { stdout: today(null) }, {
      rests: [NOW - 8 * DAY_MS, NOW - 2 * DAY_MS, NOW - DAY_MS],
      overrides: [
        { at: NOW - 8 * DAY_MS, reason: 'old one here' },
        { at: NOW - DAY_MS, reason: 'prod is down, fixing it' },
      ],
    })
    expect(text).toBe('Nothing scored this hour.\nThis week: 2 rests, 1 override ("prod is down, fixing it").')
  })

  test('two overrides quote the newest reason', async ($, on) => {
    const text = await explain($, on, { stdout: today(null) }, {
      overrides: [
        { at: NOW - 3 * DAY_MS, reason: 'deploy went wrong' },
        { at: NOW - DAY_MS, reason: 'prod is down' },
      ],
    })
    expect(text).toBe('Nothing scored this hour.\nThis week: 0 rests, 2 overrides ("prod is down").')
  })

  test('no rests or overrides, one line', async ($, on) => {
    expect(await explain($, on, { stdout: today(null) }, { rests: [NOW - 8 * DAY_MS] })).toBe('Nothing scored this hour.')
  })

  test('without cogload, the missing text', async ($, on) => {
    expect(await explain($, on, 'not found')).toBe(MISSING)
  })

  for (const [what, run] of [
    ['exits 1', { exitCode: 1, stdout: today(null), stderr: '/Users/secret/path' }],
    ['prints what does not parse', { stdout: '{' }],
    ['times out', 'timeout'],
  ] as const) {
    test(`a run that ${what} gives no reading`, async ($, on) => {
      expect(await explain($, on, run)).toBe('cogload gave no reading.')
    })
  }

  test('/cogload is registered', async ($, on) => {
    engine(on, [{ stdout: line() }])
    await start($)
    expect(commands).toContain('cogload')
  })
})

const WELCOME = 'cognitive-load shows your load above the prompt when it rises above Calm.'
const MISSING = "cognitive-load needs cogload on Claude Code's PATH: bun add -g @drakulavich/cogload"

describe('first meeting', () => {
  test('the first session.start shows the welcome toast; a second one does not', async ($, on) => {
    const toasts: string[] = []
    engine(on, [{ stdout: line() }, { stdout: line() }], [], toasts)
    await start($)
    expect(toasts).toEqual([WELCOME])
    await start($)
    expect(toasts).toEqual([WELCOME])
  })

  test('without cogload, the missing toast shows 2.1 s after the welcome, not with it', async ($, on) => {
    const toasts: string[] = []
    engine(on, ['not found'], [], toasts)
    await start($)
    expect(toasts).toEqual([WELCOME])
    await clock.advance(2099)
    expect(toasts).toEqual([WELCOME])
    await clock.advance(1)
    expect(toasts).toEqual([WELCOME, MISSING])
  })

  test('a rest starting right after the welcome shows its toast 2.1 s later', async ($, on) => {
    const toasts: string[] = []
    engine(on, [{ stdout: line({ streakMin: 40 }) }], [], toasts)
    await start($)
    expect(toasts).toEqual([WELCOME])
    await clock.advance(2099)
    expect(toasts).toEqual([WELCOME])
    await clock.advance(1)
    expect(toasts).toEqual([WELCOME, `Rest until ${hhmm(NOW + REST_MS)}. Streak 40m, Heating 68.`])
  })

  test('a run that cannot start shows the missing toast once, and a good run does not reset it', async ($, on) => {
    const toasts: string[] = []
    engine(on, ['not found', { stdout: line() }, 'not found'], [], toasts, { welcomed: true })
    await start($)
    expect(toasts).toEqual([MISSING])
    await turn($)
    await turn($)
    expect(toasts).toEqual([MISSING])
  })

  for (const [what, run] of [
    ['exits 1', { exitCode: 1 }],
    ['times out', 'timeout'],
  ] as const) {
    test(`a run that ${what} shows no missing toast`, async ($, on) => {
      const toasts: string[] = []
      engine(on, [run], [], toasts, { welcomed: true })
      await start($)
      await clock.advance(0)
      expect(toasts).toEqual([])
    })
  }
})

describe('every minute', () => {
  test('a streak that reaches 40 minutes between turns starts a rest', async ($, on) => {
    const toasts: string[] = []
    engine(on, [live(() => NOW - 39 * 60_000)], [], toasts, { welcomed: true })
    await start($)
    expect(await typed($, 'first')).toEqual({ text: 'first' })
    await clock.advance(60_000)
    expect(toasts).toHaveLength(1)
    expect(await typed($, 'next')).toEqual(DROP(NOW + 60_000 + REST_MS))
  })

  test('the band counts down the rest', async ($, on) => {
    engine(on, [live(() => NOW - 40 * 60_000)])
    await start($)
    expect(await band($)).toBe(`● Heating · rest until ${hhmm(NOW + REST_MS)} (10 min)`)
    await clock.advance(3 * 60_000)
    expect(await band($)).toBe(`● Heating · rest until ${hhmm(NOW + REST_MS)} (7 min)`)
  })

  test('the band drops the rest once it is over', async ($, on) => {
    engine(on, [live(() => NOW - 40 * 60_000)])
    await start($)
    await clock.advance(REST_MS + 60_000)
    expect(await band($)).not.toContain('rest until')
  })

  test('a tick takes a reading under a minute old instead of running cogload', async ($, on) => {
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

  test('a tick runs cogload when no reading is stored', async ($, on) => {
    engine(on, ['not found', live(() => NOW - 20 * 60_000)])
    await start($)
    expect(runCount).toBe(1)
    await clock.advance(60_000)
    expect(runCount).toBe(2)
  })
})
