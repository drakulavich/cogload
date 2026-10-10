import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const NOW = Date.parse('2026-10-03T10:00:00.000Z')
const SURFACES = ['terminal', 'desktop'] as const
const ENGINE_BAND = 'engine band'
const DAY_MS = 24 * 60 * 60_000
const ASOF = Date.parse('2026-10-03T09:59:30.000Z')
const HOME = '/Users/tester'
const BIN = `${HOME}/.bun/bin/cogload`

const iso = (ms: number) => new Date(ms).toISOString()

// `cogload status`: restAt, unless given, is where cogload puts it, the streak's start plus 40 minutes.
const line = (fields: Record<string, unknown> = {}): string => {
  const s = {
    schema: 1,
    asOf: '2026-10-03T09:59:30.000Z',
    date: '2026-10-03',
    hour: 9,
    index: 68,
    level: 'Heating',
    peak: 81,
    activeMin: 375,
    streakMin: 20,
    restMin: 10,
    ...fields,
  }
  const restAt = s.streakMin === 0 ? null : iso(Date.parse(s.asOf) + (40 - (s.streakMin as number)) * 60_000)
  return `${JSON.stringify({ restAt, ...s })}\n`
}

const live =
  (start: () => number, fields: Record<string, unknown> = {}) =>
  (): Partial<Answer> => ({
    stdout: line({
      asOf: iso(clock.now()),
      streakMin: Math.floor((clock.now() - start()) / 60_000),
      restAt: iso(start() + 40 * 60_000),
      ...fields,
    }),
  })

type Answer = { exitCode: number; stdout: string; stderr?: string }
type Run = Partial<Answer> | 'not found' | 'timeout' | Promise<Answer> | (() => Partial<Answer>)

let clock: ReturnType<typeof mock.clock>
let runCount = 0
let commands: string[] = []
let todayRuns: Run[] = []
let binRuns: Run[] = []
let calls: string[][] = []
let paths: (string | undefined)[] = []

// The engine beneath the plugin: each queued answer is one `cogload status` run, or one `cogload today --json` from todayRuns; binRuns answers BIN.
const engine = (
  on: On,
  runs: Run[],
  logs: string[] = [],
  toasts: string[] = [],
  store: Record<string, unknown> = {},
  env: Record<string, string> = { HOME },
) => {
  clock = mock.clock(on, { now: NOW })
  mock.env(on, env)
  runCount = 0
  commands = []
  todayRuns = []
  binRuns = []
  calls = []
  paths = []
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    delete store[e.key]
    return { value: undefined }
  })
  on('prompt.submit', (_$, e) => (e.context ? { text: e.text, context: e.context } : { text: e.text }))
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
    calls.push([...e.argv])
    paths.push(e.init?.env?.PATH)
    const isToday = e.argv[1] === 'today'
    const isBin = e.argv[0] !== 'cogload'
    expect(e.argv).toEqual([isBin ? BIN : 'cogload', ...(isToday ? ['today', '--json'] : ['status'])])
    if (!isToday && !isBin) runCount++
    const queue = isBin ? binRuns : isToday ? todayRuns : runs
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
  return texts
    .map(t => t.text)
    .filter(t => t !== ENGINE_BAND)
    .join('')
}

describe('reading', () => {
  for (const surface of SURFACES) {
    test(`draws the full line after session.start (${surface})`, async ($, on) => {
      engine(on, [{ stdout: line() }])
      await start($)
      expect(await band($, {}, surface)).toBe(`● Heating · ${restAt(20)}`)
    })
  }

  test('a later turn replaces the reading', async ($, on) => {
    engine(on, [{ stdout: line() }, { stdout: line({ streakMin: 25 }) }])
    await start($)
    await turn($)
    expect(await band($)).toBe(`● Heating · ${restAt(25)}`)
  })

  test('a failed run keeps the last good reading', async ($, on) => {
    const logs: string[] = []
    engine(on, [{ stdout: line() }, { exitCode: 1 }], logs)
    await start($)
    await turn($)
    expect(await band($)).toBe(`● Heating · ${restAt(20)}`)
    expect(logs).toEqual(['exit 1'])
  })

  test('keeps the band beneath on screen under its own line', async ($, on) => {
    engine(on, [{ stdout: line() }])
    await start($)
    const texts = await (await mount($)).findAll({ type: 'Text' })
    expect(texts.map(t => t.text)).toEqual(['● Heating', ` · ${restAt(20)}`, ENGINE_BAND])
  })

  test('a failed first run draws no band', async ($, on) => {
    engine(on, [{ exitCode: 1 }])
    await start($)
    expect(await band($)).toBe('')
  })

  for (const [name, stdout] of [
    ['schema 2', line({ schema: 2 })],
    ['broken JSON', '{'],
    ['a level without an index', line({ index: null, level: 'Calm' })],
    ['an index out of range', line({ index: 101 })],
    ['asOf two minutes ahead', line({ asOf: '2026-10-03T10:02:00.000Z' })],
    ['asOf without an instant timezone', line({ asOf: '2026-10-03' })],
    ['two lines', `warning\n${line()}`],
    ['restAt that is no instant', line({ restAt: '10:40' })],
    ['restMin 0', line({ restMin: 0 })],
    ['restMin 61', line({ restMin: 61 })],
    ['restMin 1.5', line({ restMin: 1.5 })],
  ] as const) {
    test(`rejects ${name}`, async ($, on) => {
      const logs: string[] = []
      engine(on, [{ stdout }], logs)
      await start($)
      expect(await band($)).toBe('')
      expect(logs).toEqual(['bad line'])
    })
  }

  test('accepts asOf less than a minute ahead', async ($, on) => {
    engine(on, [{ stdout: line({ asOf: '2026-10-03T10:00:30.000Z' }) }])
    await start($)
    expect(await band($)).toBe(`● Heating · ${restAt(20, ASOF + 60_000)}`)
  })

  test('a run that cannot start draws no band, and a later good run does', async ($, on) => {
    const logs: string[] = []
    engine(on, ['not found', { stdout: line() }], logs)
    await start($)
    expect(await band($)).toBe('')
    await turn($)
    expect(await band($)).toBe(`● Heating · ${restAt(20)}`)
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
    expect(await band($)).toBe(`● Heating · ${restAt(21)}`)
  })

  test('a run that never ends does not hold the turn', async ($, on) => {
    engine(on, [{ stdout: line() }, new Promise<Answer>(() => {})])
    await start($)
    expect(await turnOnly($)).toEqual({ text: '' })
    expect(await band($)).toBe(`● Heating · ${restAt(20)}`)
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

  for (const [streakMin, shown] of [
    [160, '2h40'],
    [5, '5m'],
  ] as const) {
    test(`formats ${streakMin} minutes once the rest is spent`, async ($, on) => {
      engine(on, [{ stdout: line({ streakMin }) }], [], [], { spent: restAtOf(streakMin) })
      await start($)
      expect(await band($)).toBe(`● Heating · streak ${shown}`)
    })
  }

  test('at 120 columns, the level and the rest time', async ($, on) => {
    engine(on, [{ stdout: line() }])
    await start($)
    expect(await band($, { bodyColumns: 120 })).toBe(`● Heating · ${restAt(20)}`)
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
    expect(await band($, { bodyColumns: 120 })).toBe(`● Heating · ${restAt(20)}`)
  })

  for (const surface of SURFACES) {
    test(`short form when narrow (${surface})`, async ($, on) => {
      engine(on, [{ stdout: line() }], [], [], { spent: restAtOf(20) })
      await start($)
      expect(await band($, { bodyColumns: 40 }, surface)).toBe(`● Heating`)
    })

    test(`no band for a null index (${surface})`, async ($, on) => {
      engine(on, [{ stdout: line({ index: null, level: null }) }])
      await start($)
      expect(await band($, {}, surface)).toBe('')
    })
  }

  test('no band before a reading', async ($, on) => {
    engine(on, [])
    expect(await band($)).toBe('')
  })

  test('no band under a survey', async ($, on) => {
    engine(on, [{ stdout: line() }])
    await start($)
    const texts = await (await mount($, { hasSurvey: true })).findAll({ type: 'Text' })
    expect(texts.map(t => t.text)).toEqual([ENGINE_BAND])
  })

  for (const surface of SURFACES) {
    test(`a band while Calm (${surface})`, async ($, on) => {
      engine(on, [{ stdout: line({ level: 'Calm', index: 20, streakMin: 0 }) }])
      await start($)
      expect(await band($, {}, surface)).toBe('● Calm')
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
    const tail = await ui.find({ type: 'Text', text: ` · ${restAt(20)}` })
    expect(tail).toMatchObject({ props: { dimColor: true } })
    expect(tail?.props).not.toHaveProperty('color')
  })
})

const REST_MS = 10 * 60_000
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
// The band before a rest: the streak's start plus 40 minutes.
const restAt = (streakMin: number, asOf = ASOF) => `rest at ${hhmm(asOf + (40 - streakMin) * 60_000)}`
const restAtOf = (streakMin: number) => iso(ASOF + (40 - streakMin) * 60_000)
const PHRASES = [
  'Stand up and stretch.',
  'Water, then a window.',
  'Look at something far away.',
  'Walk to the kitchen and back.',
  'Roll your shoulders, unclench your jaw.',
  'Close your eyes for a minute.',
  'Breathe out slower than you breathe in.',
  'The code will wait.',
]
const DROP = (until: number, { n = 0 }: { n?: number } = {}) => ({
  drop: `${PHRASES[n]} ${Math.ceil((until - clock.now()) / 60_000)} min left. ${BACK}`,
})
const SHORT = 'A skip needs a reason of three words or more.'
const BACK = 'Your prompt is back in the box: to send it, add "skip: <reason>" as its last line.'
const PAST = (until: number) =>
  `The person is on a rest until ${hhmm(until)}. This prompt came from their phone through Remote Control, which the rest lets through. Begin your reply with one short line saying it went past the rest, then answer as usual.`
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

  test('a rest starts when asOf reaches restAt, whatever the streak', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 20, restAt: iso(ASOF) }) }])
    await start($)
    expect(await typed($, 'next')).toEqual(DROP(NOW + REST_MS))
  })

  test('a rest does not start a minute before restAt, whatever the streak', async ($, on) => {
    const toasts: string[] = []
    engine(on, [{ stdout: line({ streakMin: 45, restAt: iso(ASOF + 60_000) }) }], [], toasts, { welcomed: true })
    await start($)
    expect(await typed($, 'next')).toEqual({ text: 'next' })
    expect(toasts).toEqual([])
  })

  test('a rest lasts restMin minutes', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40, restMin: 7 }) }])
    await start($)
    expect(await band($)).toBe(`● Heating · rest until ${hhmm(NOW + 7 * 60_000)} (7 min)`)
    await clock.advance(7 * 60_000)
    expect(await typed($, 'next')).toEqual({ text: 'next' })
  })

  test('the same restAt after a rest starts no second one; a new restAt does', async ($, on) => {
    const toasts: string[] = []
    let fields: Record<string, unknown> = { streakMin: 40, restAt: iso(NOW) }
    engine(on, [() => ({ stdout: line({ asOf: iso(clock.now()), ...fields }) })], [], toasts, { welcomed: true })
    await start($)
    await clock.advance(12 * 60_000)
    fields = { streakMin: 40, restAt: iso(NOW) }
    await clock.advance(60_000)
    expect(toasts).toHaveLength(1)
    expect(await typed($, 'go')).toEqual({ text: 'go' })
    fields = { streakMin: 40, restAt: iso(clock.now()) }
    await clock.advance(60_000)
    expect(toasts).toHaveLength(2)
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

  test('each held composer prompt gets the next phrase, the minutes left, that it is back in the box and the way out', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    expect(await typed($, 'next task')).toEqual({
      drop: `Stand up and stretch. 10 min left. ${BACK}`,
    })
    await clock.advance(3 * 60_000)
    expect(await typed($, 'next task')).toEqual({
      drop: `Water, then a window. 7 min left. ${BACK}`,
    })
  })

  test('the ninth held prompt starts the phrases over', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    for (const n of PHRASES.keys()) expect(await typed($, 'next')).toEqual(DROP(NOW + REST_MS, { n }))
    expect(await typed($, 'next')).toEqual(DROP(NOW + REST_MS))
  })

  test('a bridge prompt goes past the rest with a note for Claude', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    expect(await typed($, 'next task', 'bridge')).toEqual({ text: 'next task', context: [PAST(NOW + REST_MS)] })
    expect(await typed($, 'next')).toEqual(DROP(NOW + REST_MS))
  })

  // Claude Code puts a dropped prompt back in the box itself; a fill on top doubled it (2.1.295).
  for (const [what, prompt] of [
    ['a composer prompt', ($: Engine) => typed($, 'next task\nand more')],
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

  test('a Fried hour rests once: the next streak inside the hour passes', async ($, on) => {
    const toasts: string[] = []
    let streakStart = NOW - 5 * 60_000
    engine(on, [live(() => streakStart, { level: 'Fried', index: 90 })], [], toasts, { welcomed: true })
    await start($)
    await clock.advance(11 * 60_000)
    streakStart = clock.now()
    await clock.advance(60_000)
    expect(toasts).toHaveLength(1)
    expect(await typed($, 'next')).toEqual({ text: 'next' })
  })

  test('a Fried reading an hour after the last Fried rest rests again', async ($, on) => {
    const toasts: string[] = []
    let streakStart = NOW - 5 * 60_000
    engine(on, [live(() => streakStart, { level: 'Fried', index: 90 })], [], toasts, { welcomed: true })
    await start($)
    await clock.advance(61 * 60_000)
    streakStart = clock.now() - 5 * 60_000
    await clock.advance(60_000)
    expect(toasts).toHaveLength(2)
    expect(await typed($, 'next')).toEqual(DROP(clock.now() + REST_MS))
  })

  test('a 40-minute streak rests inside a Fried hour', async ($, on) => {
    const toasts: string[] = []
    let streakStart = NOW - 5 * 60_000
    engine(on, [live(() => streakStart, { level: 'Fried', index: 90 })], [], toasts, { welcomed: true })
    await start($)
    await clock.advance(11 * 60_000)
    streakStart = clock.now()
    await clock.advance(39 * 60_000)
    expect(toasts).toHaveLength(1)
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

describe('rest at', () => {
  test('a live streak shows when its rest starts, and the time stays put', async ($, on) => {
    engine(on, [live(() => NOW - 19 * 60_000)])
    await start($)
    const at = `● Heating · rest at ${hhmm(NOW + 21 * 60_000)}`
    expect(await band($)).toBe(at)
    await clock.advance(60_000)
    expect(await band($)).toBe(at)
    await clock.advance(60_000)
    expect(await band($)).toBe(at)
  })

  test('streak 37 shows the clock time, not minutes left', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 37 }) }])
    await start($)
    expect(await band($)).toBe(`● Heating · ${restAt(37)}`)
  })

  test('after an override lifts the rest, the streak', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    expect(await typed($, 'override: prod is down, fixing it')).toEqual({ drop: 'Rest lifted.' })
    expect(await band($)).toBe('● Heating · streak 40m')
  })

  test('shows at 45 columns; a spent streak there is the level alone', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 37 }) }])
    await start($)
    expect(await band($, { bodyColumns: 45 })).toBe(`● Heating · ${restAt(37)}`)
  })

  test('a spent streak at 45 columns is the level alone', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 37 }) }], [], [], { spent: restAtOf(37) })
    await start($)
    expect(await band($, { bodyColumns: 45 })).toBe('● Heating')
  })

  test('draws the band while Calm', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 37, level: 'Calm', index: 20 }) }])
    await start($)
    expect(await band($)).toBe(`● Calm · ${restAt(37)}`)
  })

  test('none for a streak that already held', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 37 }) }], [], [], { spent: restAtOf(37) })
    await start($)
    expect(await band($)).toBe('● Heating · streak 37m')
  })

  test('a restAt five minutes off the spent one is another streak', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 37 }) }], [], [], { spent: iso(Date.parse(restAtOf(37)) - 5 * 60_000) })
    await start($)
    expect(await band($)).toBe(`● Heating · ${restAt(37)}`)
  })

  test("shows restAt in local time, not the streak's minutes", async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 20, restAt: iso(ASOF + 7 * 60_000) }) }])
    await start($)
    expect(await band($)).toBe(`● Heating · rest at ${hhmm(ASOF + 7 * 60_000)}`)
  })
})

describe('override', () => {
  test('after a held prompt, an override lifts the rest and sends the second line', async ($, on) => {
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

  for (const prompt of ['override: ok\nfix it', 'override:', 'override: prod down', 'fix it\noverride: no']) {
    test(`${JSON.stringify(prompt)} asks for a longer reason, fills nothing and keeps the rest`, async ($, on) => {
      const fills: string[] = []
      engine(on, [{ stdout: line({ streakMin: 40 }) }])
      on('prompt.fill', (_$, e) => {
        fills.push(e.text)
        return { isFilled: true }
      })
      await start($)
      expect(await typed($, prompt)).toEqual({ drop: `${SHORT} Your prompt is back in the box.` })
      await clock.advance(0)
      expect(fills).toEqual([])
      expect(await typed($, 'next')).toEqual(DROP(NOW + REST_MS))
    })
  }

  test('a short override from a bridge goes past the rest', async ($, on) => {
    const fills: string[] = []
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    on('prompt.fill', (_$, e) => {
      fills.push(e.text)
      return { isFilled: true }
    })
    await start($)
    expect(await typed($, 'override: ok\nfix it', 'bridge')).toEqual({ text: 'override: ok\nfix it', context: [PAST(NOW + REST_MS)] })
    await clock.advance(0)
    expect(fills).toEqual([])
  })

  test('an override alone lifts the rest and sends nothing', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    expect(await typed($, 'override: prod is down')).toEqual({ drop: 'Rest lifted.' })
    expect(await typed($, 'next')).toEqual({ text: 'next' })
  })

  for (const [prompt, sent, reason] of [
    ['fix the retry\noverride: prod is down', 'fix the retry', 'prod is down'],
    ['fix it\n\noverride: prod is down now\n\n', 'fix it', 'prod is down now'],
    ['override: prod is down\nfix this\noverride: also prod is down', 'fix this', 'prod is down'],
  ] as const) {
    test(`${JSON.stringify(prompt)} lifts the rest and sends ${JSON.stringify(sent)}`, async ($, on) => {
      const store: Record<string, unknown> = {}
      engine(on, [{ stdout: line({ streakMin: 40 }) }], [], [], store)
      await start($)
      expect(await typed($, prompt)).toEqual({ text: sent })
      expect(store.overrides).toEqual([{ at: NOW, reason }])
    })
  }

  test('an override line in the middle of a prompt is held like any other', async ($, on) => {
    const store: Record<string, unknown> = {}
    engine(on, [{ stdout: line({ streakMin: 40 }) }], [], [], store)
    await start($)
    expect(await typed($, 'a\noverride: prod is down now\nb')).toEqual(DROP(NOW + REST_MS))
    expect(store.overrides).toBeUndefined()
  })

  for (const [prompt, sent] of [
    ['fix it\nskip: prod is down now', { text: 'fix it' }],
    ['Skip: prod is down now', { drop: 'Rest lifted.' }],
  ] as const) {
    test(`${JSON.stringify(prompt)} lifts the rest and keeps the reason`, async ($, on) => {
      const store: Record<string, unknown> = {}
      engine(on, [{ stdout: line({ streakMin: 40 }) }], [], [], store)
      await start($)
      expect(await typed($, prompt)).toEqual(sent)
      expect(store.overrides).toEqual([{ at: NOW, reason: 'prod is down now' }])
    })
  }

  test('a short skip asks for a longer reason', async ($, on) => {
    engine(on, [{ stdout: line({ streakMin: 40 }) }])
    await start($)
    expect(await typed($, 'skip: no')).toEqual({ drop: 'A skip needs a reason of three words or more. Your prompt is back in the box.' })
  })

  for (const prompt of ['Override: prod is down', 'OVERRIDE: prod is down']) {
    test(`${JSON.stringify(prompt)}, as a phone keyboard types it, lifts the rest`, async ($, on) => {
      engine(on, [{ stdout: line({ streakMin: 40 }) }])
      await start($)
      expect(await typed($, prompt)).toEqual({ drop: 'Rest lifted.' })
      expect(await typed($, 'next')).toEqual({ text: 'next' })
    })
  }

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
const today = (live: Record<string, unknown> | null, score: Record<string, unknown> = {}) =>
  `${JSON.stringify({
    date: '2026-10-03',
    peak: 81,
    mean: 40,
    activeMin: 375,
    presence: null,
    buckets: [],
    asOf: '2026-10-03T09:59:30.000Z',
    live: live && { ...METRICS, ...live, score: { index: 80, level: 'Heating', parts: NO_PARTS, capped: [], top: 'supervision', ...score } },
  })}\n`

const explain = async ($: Engine, on: On, answer: Run, store: Record<string, unknown> = {}) => {
  engine(on, [{ stdout: line() }], [], [], { welcomed: true, ...store })
  todayRuns = [answer]
  await start($)
  return (await $.command.run({ command: 'cogload' })).text
}

describe('/cogload', () => {
  for (const [part, metrics, phrase] of [
    ['parallel', { sessions: 5 }, '5 sessions at once'],
    ['pace', { prompts: 32 }, '32 prompts'],
    ['supervision', { decisions: 16, contextSwitches: 13 }, '16 decisions and 13 context switches'],
    ['reading', { outputTokens: 81_400 }, '81k output tokens'],
    ['streak', { streakMin: 57 }, 'a 57m streak'],
    ['late', { lateNight: true }, 'late at night'],
  ] as const) {
    test(`${part} alone at its cap`, async ($, on) => {
      expect(await explain($, on, { stdout: today(metrics, { capped: [part] }) })).toBe(`Heating 80 this hour, at the cap: ${phrase}.`)
    })
  }

  test("names the parts in capped, in cogload's order", async ($, on) => {
    const stdout = today(
      { prompts: 32, decisions: 16, contextSwitches: 13, streakMin: 57 },
      { capped: ['streak', 'pace', 'supervision'], parts: { ...NO_PARTS, streak: 10, pace: 15, supervision: 30 } },
    )
    expect(await explain($, on, { stdout })).toBe('Heating 80 this hour, at the cap: a 57m streak, 32 prompts, 16 decisions and 13 context switches.')
  })

  test("with none capped, cogload's top part", async ($, on) => {
    const stdout = today(
      { sessions: 4, outputTokens: 40_000 },
      { index: 45, level: 'Warming', top: 'reading', parts: { ...NO_PARTS, parallel: 18.8, reading: 2 } },
    )
    expect(await explain($, on, { stdout })).toBe('Warming 45 this hour, mostly 40k output tokens.')
  })

  test('a score cooled to 0 names no part', async ($, on) => {
    const stdout = today({ prompts: 16, contextSwitches: 15 }, { index: 0, level: 'Calm', top: 'supervision', parts: NO_PARTS })
    expect(await explain($, on, { stdout })).toBe('Calm 0 this hour: you have been away.')
  })

  test("quotes live's streak as cogload counts it", async ($, on) => {
    const presence = { lastAt: '2026-10-03T09:58:30.000Z', streakStartAt: '2026-10-03T09:11:30.000Z' }
    const stdout = today({ streakMin: 9 }, { capped: ['streak'] }).replace('"presence":null', `"presence":${JSON.stringify(presence)}`)
    expect(await explain($, on, { stdout })).toBe('Heating 80 this hour, at the cap: a 9m streak.')
  })

  test('a score without capped is an older cogload', async ($, on) => {
    const stdout = today({}).replace(',"capped":[],"top":"supervision"', '')
    expect(await explain($, on, { stdout }, { rests: [NOW - DAY_MS] })).toBe(OLDER)
  })

  test('no live hour', async ($, on) => {
    expect(await explain($, on, { stdout: today(null) })).toBe('Nothing scored this hour.')
  })

  test('a live hour with no score', async ($, on) => {
    expect(await explain($, on, { stdout: today(null).replace('"live":null', `"live":${JSON.stringify({ ...METRICS, score: null })}`) })).toBe(
      'Nothing scored this hour.',
    )
  })

  test("the week's rests taken and skipped, with the reason", async ($, on) => {
    const text = await explain($, on, { stdout: today(null) }, {
      rests: [NOW - 8 * DAY_MS, NOW - 2 * DAY_MS, NOW - DAY_MS],
      overrides: [
        { at: NOW - 8 * DAY_MS + 60_000, reason: 'old one here' },
        { at: NOW - DAY_MS + 5 * 60_000, reason: 'prod is down, fixing it' },
      ],
    })
    expect(text).toBe('Nothing scored this hour.\nThis week: 1 rest taken, 1 skipped (last: "prod is down, fixing it").')
  })

  test('an override whose rest fell out of the week leaves the rests taken alone', async ($, on) => {
    const text = await explain($, on, { stdout: today(null) }, {
      rests: [NOW - 7 * DAY_MS - 5 * 60_000, NOW - DAY_MS],
      overrides: [{ at: NOW - 7 * DAY_MS + 60_000, reason: 'prod is down' }],
    })
    expect(text).toBe('Nothing scored this hour.\nThis week: 1 rest taken.')
  })

  test('two overrides quote the newest reason', async ($, on) => {
    const text = await explain($, on, { stdout: today(null) }, {
      rests: [NOW - 3 * DAY_MS - 60_000, NOW - DAY_MS - 60_000],
      overrides: [
        { at: NOW - 3 * DAY_MS, reason: 'deploy went wrong' },
        { at: NOW - DAY_MS, reason: 'prod is down' },
      ],
    })
    expect(text).toBe('Nothing scored this hour.\nThis week: 0 rests taken, 2 skipped (last: "prod is down").')
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

const WELCOME = 'Keep your head cold. The dot above the prompt shows how hot this hour runs.'
const MISSING = "cogload is not on Claude Code's PATH: bun add -g @drakulavich/cogload"
const OLDER = 'cogload is older than this plugin: bun add -g @drakulavich/cogload@latest'

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

  test('a status line without restAt shows the older text once and no band', async ($, on) => {
    const toasts: string[] = []
    const old = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(line())).filter(([k]) => k !== 'restAt' && k !== 'restMin')))
    engine(on, [{ stdout: old }, { stdout: old }], [], toasts, { welcomed: true })
    await start($)
    await turn($)
    expect(toasts).toEqual([OLDER])
    expect(await band($)).toBe('')
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

describe('a stale reading', () => {
  const read = (fields: Record<string, unknown> = {}) => ({ stdout: line({ asOf: new Date(NOW).toISOString(), ...fields }) })
  const failing = (n: number) => Array.from({ length: n }, () => ({ exitCode: 1 }))

  test('while cogload fails, the band draws at 4 minutes and is empty from the tick at 5', async ($, on) => {
    engine(on, [read(), ...failing(10)])
    await start($)
    await clock.advance(4 * 60_000)
    expect(await band($)).toBe(`● Heating · ${restAt(20, NOW)}`)
    await clock.advance(60_000)
    expect(await band($)).toBe('')
  })

  test('after it clears, the next good reading draws the band', async ($, on) => {
    engine(on, [read(), ...failing(6), live(() => NOW - 20 * 60_000)])
    await start($)
    await clock.advance(6 * 60_000)
    expect(await band($)).toBe('')
    await clock.advance(60_000)
    expect(await band($)).toBe(`● Heating · ${restAt(20, NOW)}`)
  })

  test('a rest keeps holding prompts after its reading clears', async ($, on) => {
    engine(on, [read({ streakMin: 40 }), ...failing(10)])
    await start($)
    await clock.advance(5 * 60_000)
    expect(await band($)).toBe('')
    expect(await typed($, 'next')).toEqual(DROP(NOW + REST_MS))
  })
})

const STATUS = ['cogload', 'status']
const TODAY = ['cogload', 'today', '--json']
const expectNoHome = (texts: (string | undefined)[]) => {
  for (const text of texts) expect(text).not.toContain(HOME)
}

describe('cogload in ~/.bun/bin', () => {
  test('without cogload on the PATH, the band draws from ~/.bun/bin', async ($, on) => {
    const logs: string[] = []
    const toasts: string[] = []
    engine(on, ['not found'], logs, toasts, { welcomed: true })
    binRuns = [{ stdout: line() }]
    await start($)
    const text = await band($)
    expectNoHome([text])
    expect(text).toBe(`● Heating · ${restAt(20)}`)
    expect(calls).toEqual([STATUS, [BIN, 'status']])
    expect(toasts).toEqual([])
    expect(logs).toEqual([])
  })

  for (const [what, env, path] of [
    ['set', { HOME, PATH: '/usr/bin:/bin' }, `${HOME}/.bun/bin:/usr/bin:/bin`],
    ['unset', { HOME }, `${HOME}/.bun/bin`],
    ['empty', { HOME, PATH: '' }, `${HOME}/.bun/bin`],
  ] as const) {
    test(`with PATH ${what}, the fallback runs with PATH ${path}`, async ($, on) => {
      engine(on, ['not found'], [], [], { welcomed: true }, env)
      binRuns = [{ stdout: line() }]
      await start($)
      expect(paths).toEqual([undefined, path])
    })
  }

  test('without cogload on the PATH, /cogload reads from ~/.bun/bin', async ($, on) => {
    const logs: string[] = []
    const toasts: string[] = []
    engine(on, [{ stdout: line() }], logs, toasts, { welcomed: true, rests: [NOW - DAY_MS] })
    todayRuns = ['not found']
    binRuns = [{ stdout: today({ sessions: 5 }, { capped: ['parallel'] }) }]
    await start($)
    const text = (await $.command.run({ command: 'cogload' })).text
    expectNoHome([text, ...logs, ...toasts])
    expect(text).toBe('Heating 80 this hour, at the cap: 5 sessions at once.\nThis week: 1 rest taken.')
    expect(calls).toEqual([STATUS, TODAY, [BIN, 'today', '--json']])
  })

  for (const [what, env, tried] of [
    ['missing from both', { HOME }, [STATUS, [BIN, 'status'], TODAY, [BIN, 'today', '--json']]],
    ['missing with HOME unset', {}, [STATUS, TODAY]],
  ] as const) {
    test(`cogload ${what}: the missing toast once and the missing text`, async ($, on) => {
      const logs: string[] = []
      const toasts: string[] = []
      engine(on, ['not found'], logs, toasts, { welcomed: true }, env)
      await start($)
      const text = (await $.command.run({ command: 'cogload' })).text
      expectNoHome([text, ...logs, ...toasts])
      expect(calls).toEqual(tried)
      expect(toasts).toEqual([MISSING])
      expect(text).toBe(MISSING)
      expect(logs).toEqual(['not found'])
    })
  }

  for (const [failure, run] of [
    ['timeout', 'timeout'],
    ['exit 1', { exitCode: 1 }],
    ['bad line', { stdout: '{' }],
  ] as const) {
    test(`a cogload that gives ${failure} is not tried again in ~/.bun/bin`, async ($, on) => {
      const logs: string[] = []
      const toasts: string[] = []
      engine(on, [run], logs, toasts, { welcomed: true })
      binRuns = [{ stdout: line() }]
      await start($)
      await clock.advance(0)
      const text = await band($)
      expectNoHome([text, ...logs, ...toasts])
      expect(calls).toEqual([STATUS])
      expect(text).toBe('')
      expect(logs).toEqual([failure])
    })
  }
})
