import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Level, Status } from '../types'

const status = atom({ plugin: 'cognitive-load', key: 'status' } as const, null)
const lastToast = atom({ plugin: 'cognitive-load', key: 'lastToast' } as const, 0)

const LEVELS = ['Calm', 'Warming', 'Heating', 'Fried'] as const
const COLOR: Record<Level, string> = { Calm: 'success', Warming: 'warning', Heating: '#ff8700', Fried: 'red' }
const NARROW = 50
const CLOCK_SKEW_MS = 60_000
const TOAST_GAP_MS = 2100
const HELD: readonly string[] = ['composer', 'bridge']
const WEEK_MS = 7 * 24 * 60 * 60_000
const HOUR_MS = 60 * 60_000
const SKIP = /^(?:skip|override):(.*)$/i
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
const SHORT = 'A skip needs a reason of three words or more.'
const BACK = 'Your prompt is back in the box: to send it, add "skip: <reason>" as its last line.'
const WELCOME = 'Keep your head cold. The dot above the prompt shows how hot this hour runs.'
const MISSING = "cogload is not on Claude Code's PATH: bun add -g @drakulavich/cogload"
const NO_READING = 'cogload gave no reading.'
const OLDER = 'cogload is older than this plugin: bun add -g @drakulavich/cogload@latest'
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

type Override = { at: number; reason: string }
type Part = 'parallel' | 'pace' | 'supervision' | 'reading' | 'streak' | 'late'
type Live = {
  sessions: number
  prompts: number
  decisions: number
  contextSwitches: number
  outputTokens: number
  streakMin: number
  score: { index: number; level: Level; capped: Part[]; top: Part } | null
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max

const isIndex = (v: unknown): v is number | null => v === null || isInt(v, 0, 100)

const isInstant = (v: unknown): v is string => typeof v === 'string' && ISO_INSTANT.test(v)

const decodeStatus = (stdout: string, nowMs: number): Status | null => {
  let s: unknown
  try {
    s = JSON.parse(stdout.trim())
  } catch {
    return null
  }
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return null
  const o = s as Record<string, unknown>
  const asOf = isInstant(o.asOf) ? Date.parse(o.asOf) : Number.NaN
  const isLevel = o.index === null ? o.level === null : LEVELS.includes(o.level as Level)
  const isValid =
    o.schema === 1 &&
    !Number.isNaN(asOf) &&
    asOf <= nowMs + CLOCK_SKEW_MS &&
    typeof o.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(o.date) &&
    isInt(o.hour, 0, 23) &&
    isIndex(o.index) &&
    isIndex(o.peak) &&
    isLevel &&
    isInt(o.activeMin, 0, 1500) &&
    isInt(o.streakMin, 0, 1500) &&
    (o.restAt === null || isInstant(o.restAt)) &&
    isInt(o.restMin, 1, 60)
  return isValid
    ? {
        schema: 1,
        asOf: o.asOf as string,
        date: o.date as string,
        hour: o.hour as number,
        index: o.index as number | null,
        level: o.level as Level | null,
        peak: o.peak as number | null,
        activeMin: o.activeMin as number,
        streakMin: o.streakMin as number,
        restAt: o.restAt as string | null,
        restMin: o.restMin as number,
      }
    : null
}

// Claude Code drops a plugin's toast that comes within 2000 ms of its last one.
const toast = async ($: EngineInterface, text: string) => {
  const now = await $.clock.now()
  let at = now
  await update($, lastToast, last => {
    at = Math.max(now, last + TOAST_GAP_MS)
    return at
  })
  if (at === now) $.ui.toast(text)
  else $.clock.after(at - now, () => $.ui.toast(text))
}

const formatMinutes = (min: number): string =>
  min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`

const clockTime = (ms: number): string => new Date(ms).toTimeString().slice(0, 5)

const PHRASE: Record<Part, (l: Live) => string> = {
  parallel: l => `${l.sessions} sessions at once`,
  pace: l => `${l.prompts} prompts`,
  supervision: l => `${l.decisions} decisions and ${l.contextSwitches} context switches`,
  reading: l => `${Math.round(l.outputTokens / 1000)}k output tokens`,
  streak: l => `a ${formatMinutes(l.streakMin)} streak`,
  late: () => 'late at night',
}

const hourLine = (live: Live, score: NonNullable<Live['score']>): string => {
  const head = `${score.level} ${score.index} this hour`
  if (score.index === 0) return `${head}: you have been away.`
  if (score.capped.length > 0) return `${head}, at the cap: ${score.capped.map(p => PHRASE[p](live)).join(', ')}.`
  return `${head}, mostly ${PHRASE[score.top](live)}.`
}

type Day = { live?: Live | null }

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

const restUntil = async ($: EngineInterface, now: number): Promise<number | null> => {
  const until = await $.store.get('restUntil')
  return typeof until === 'number' && now < until ? until : null
}

const overridesSince = async ($: EngineInterface, since: number): Promise<Override[]> => {
  const list = await $.store.get('overrides')
  return Array.isArray(list) ? (list as Override[]).filter(o => o.at > since) : []
}

const restsSince = async ($: EngineInterface, since: number): Promise<number[]> => {
  const list = await $.store.get('rests')
  return Array.isArray(list) ? (list as number[]).filter(at => at > since) : []
}

const isSpent = async ($: EngineInterface, s: Status): Promise<boolean> =>
  s.restAt !== null && (await $.store.get('spent')) === s.restAt

const startRestIfDue = async ($: EngineInterface, s: Status) => {
  const now = await $.clock.now()
  const isFried = s.level === 'Fried'
  const friedAt = await $.store.get('friedAt')
  const isFriedDue = isFried && (typeof friedAt !== 'number' || now - friedAt >= HOUR_MS)
  const isStreakDue = s.restAt !== null && Date.parse(s.asOf) >= Date.parse(s.restAt)
  if (!isStreakDue && !isFriedDue) return
  if (await isSpent($, s)) return
  const until = now + s.restMin * 60_000
  await $.store.set('restUntil', until)
  await $.store.set('rests', [...(await restsSince($, now - WEEK_MS)), now])
  await $.store.set('spent', s.restAt)
  if (isFried) await $.store.set('friedAt', now)
  await toast($, `Rest until ${clockTime(until)}. Streak ${formatMinutes(s.streakMin)}, ${s.level} ${s.index}.`)
}

const toastOnce = async ($: EngineInterface, key: string, text: string) => {
  if ((await $.store.get(key)) === true) return
  await $.store.set(key, true)
  await toast($, text)
}

const RUN_TIMEOUT_MS = 10_000
const REFRESH_MS = 60_000
const STALE_MS = 5 * 60_000

const weekLine = async ($: EngineInterface, now: number): Promise<string | null> => {
  const rests = await restsSince($, now - WEEK_MS)
  if (rests.length === 0) return null
  const pushed = (await overridesSince($, now - WEEK_MS)).filter(o => rests.some(at => at <= o.at))
  const taken = `This week: ${plural(rests.length - pushed.length, 'rest')} taken`
  const newest = pushed.at(-1)
  return newest === undefined ? `${taken}.` : `${taken}, ${pushed.length} skipped (last: "${newest.reason}").`
}

const spawn = async ($: EngineInterface, argv: string[], env?: Record<string, string>) => {
  const startedAt = await $.clock.now()
  try {
    return await $.process.run(argv, { timeoutMs: RUN_TIMEOUT_MS, env })
  } catch {
    return (await $.clock.now()) - startedAt >= RUN_TIMEOUT_MS ? 'timeout' : 'not found'
  }
}

const run = async ($: EngineInterface, args: string[]) => {
  const r = await spawn($, ['cogload', ...args])
  if (r !== 'not found') return r
  const home = await $.env.get('HOME')
  if (home === undefined) return r
  const bin = `${home}/.bun/bin`
  const path = await $.env.get('PATH')
  // cogload is a `#!/usr/bin/env bun` script, and a script-installed bun sits beside it.
  return spawn($, [`${bin}/cogload`, ...args], { PATH: path ? `${bin}:${path}` : bin })
}

const take = async ($: EngineInterface, s: Status) => {
  await startRestIfDue($, s)
  await update($, status, () => s)
}

const isOlder = (stdout: string): boolean => {
  try {
    const o = JSON.parse(stdout.trim())
    return o?.schema === 1 && o.restAt === undefined
  } catch {
    return false
  }
}

const refresh = async ($: EngineInterface) => {
  const r = await run($, ['status'])
  const decoded = typeof r === 'string' || r.exitCode !== 0 ? null : decodeStatus(r.stdout, await $.clock.now())
  if (decoded === null) {
    const failure = typeof r === 'string' ? r : r.exitCode === 0 ? 'bad line' : `exit ${r.exitCode}`
    $.ui.log(failure, { to: 'debug' })
    if (failure === 'not found') await toastOnce($, 'missingShown', MISSING)
    if (typeof r !== 'string' && r.exitCode === 0 && isOlder(r.stdout)) await toastOnce($, 'olderShown', OLDER)
    return false
  }
  await $.store.set('reading', decoded)
  await take($, decoded)
  return true
}

const tick = async ($: EngineInterface) => {
  const reading = (await $.store.get('reading')) as Status | undefined
  const age = reading === undefined ? Number.POSITIVE_INFINITY : (await $.clock.now()) - Date.parse(reading.asOf)
  if (reading !== undefined && age < REFRESH_MS) return take($, reading)
  if ((await refresh($)) || age < STALE_MS) return
  await $.store.delete('reading')
  await update($, status, () => null)
}

export const register: Register = on => {
  // Not awaited: the engine holds the turn until these hooks return.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'cogload', description: "What drives this hour's load, and the week's rests and skips" })
    toastOnce($, 'welcomed', WELCOME)
      .catch(() => {})
      .then(() => refresh($))
      .catch(() => {})
    $.clock.every(REFRESH_MS, () => {
      tick($).catch(() => {})
    })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    refresh($).catch(() => {})
    return result
  })

  on('command.run', { command: 'cogload' }, async $ => {
    const r = await run($, ['today', '--json'])
    if (r === 'not found') return { text: MISSING }
    let day: unknown = null
    try {
      if (r !== 'timeout' && r.exitCode === 0) day = JSON.parse(r.stdout)
    } catch {}
    if (typeof day !== 'object' || day === null) return { text: NO_READING }
    const live = (day as Day).live
    const score = live?.score
    if (score && !Array.isArray(score.capped)) return { text: OLDER }
    const hour = live && score ? hourLine(live, score) : 'Nothing scored this hour.'
    const week = await weekLine($, await $.clock.now())
    return { text: [hour, ...(week === null ? [] : [week])].join('\n') }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!HELD.includes(e.origin.kind)) return next(e)
    const now = await $.clock.now()
    const until = await restUntil($, now)
    if (until === null) return next(e)
    const lines = e.text.trimEnd().split('\n')
    const first = SKIP.exec(lines[0] ?? '')
    const last = lines.length > 1 ? SKIP.exec(lines.at(-1) ?? '') : null
    const skip = first ?? last
    const reason = skip?.[1].trim() ?? ''
    if (reason.split(/\s+/).length >= 3) {
      await $.store.delete('restUntil')
      await $.store.set('overrides', [...(await overridesSince($, now - WEEK_MS)), { at: now, reason }])
      const text = lines.slice(first ? 1 : 0, last ? -1 : undefined).join('\n').trim()
      return text === '' ? { drop: 'Rest lifted.' } : next({ ...e, text })
    }
    const isComposer = e.origin.kind === 'composer'
    if (skip !== null) return { drop: `${SHORT}${isComposer ? ' Your prompt is back in the box.' : ''}` }
    const phrase = await $.store.get('phrase')
    const n = typeof phrase === 'number' ? phrase : 0
    await $.store.set('phrase', (n + 1) % PHRASES.length)
    const left = `${Math.ceil((until - now) / 60_000)} min left`
    return { drop: `${PHRASES[n % PHRASES.length]} ${left}. ${isComposer ? BACK : 'To go on: "skip: <reason>".'}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const beneath = await next(e)
    const s = await read($, status)
    if (e.props.hasSurvey || s === null || s.index === null || s.level === null) return beneath
    const now = await $.clock.now()
    const until = await restUntil($, now)
    const isAhead = until === null && s.restAt !== null && Date.parse(s.restAt) > Date.parse(s.asOf) && !(await isSpent($, s))
    const parts: string[] = []
    if (until !== null) parts.push(`rest until ${clockTime(until)} (${Math.ceil((until - now) / 60_000)} min)`)
    else if (isAhead && s.restAt !== null) parts.push(`rest at ${clockTime(Date.parse(s.restAt))}`)
    else if (e.props.bodyColumns >= NARROW && s.streakMin > 0) parts.push(`streak ${formatMinutes(s.streakMin)}`)
    const { Box, Text } = $.ui.resolve(e)
    const head = Text({ color: COLOR[s.level], children: `● ${s.level}` })
    const own =
      parts.length === 0 ? head : Box({ children: [head, Text({ dimColor: true, children: parts.map(p => ` · ${p}`).join('') })] })
    return Box({ flexDirection: 'column', children: [own, beneath] })
  })
}
