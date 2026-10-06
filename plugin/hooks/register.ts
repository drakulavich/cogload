import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Level, Status } from '../types'

const status = atom({ plugin: 'cognitive-load', key: 'status' } as const, null)
const lastToast = atom({ plugin: 'cognitive-load', key: 'lastToast' } as const, 0)

const LEVELS = ['Calm', 'Warming', 'Heating', 'Fried'] as const
const COLOR: Record<Level, string> = { Calm: 'success', Warming: 'warning', Heating: '#ff8700', Fried: 'red' }
const NARROW = 50
const CLOCK_SKEW_MS = 60_000
const REST_AFTER_MIN = 40 // NORMS.streakMin in src/lib/metrics/score.ts
const WEIGHTS = { parallel: 25, pace: 15, supervision: 30, reading: 10, streak: 10, late: 10 } as const // WEIGHTS in src/lib/metrics/score.ts
const WARN_AFTER_MIN = 35
const REST_MS = 10 * 60_000 // GAP_MS in src/lib/metrics
const TOAST_GAP_MS = 2100
const HELD: readonly string[] = ['composer', 'bridge']
const WEEK_MS = 7 * 24 * 60 * 60_000
const OVERRIDE = /^override:(.*)$/i
const HINT = ' To go on now, start the prompt with "override: <reason>".'
const SHORT = 'An override needs a reason of three words or more.'
const WELCOME = 'Keep your head cold. The dot above the prompt shows how hot this hour runs.'
const MISSING = "cogload is not on Claude Code's PATH: bun add -g @drakulavich/cogload"
const NO_READING = 'cogload gave no reading.'

type Override = { at: number; reason: string }
type Part = keyof typeof WEIGHTS
type Live = {
  sessions: number
  prompts: number
  decisions: number
  contextSwitches: number
  outputTokens: number
  streakMin: number
  score: { index: number; level: Level; parts: Record<Part, number> } | null
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max

const isIndex = (v: unknown): v is number | null => v === null || isInt(v, 0, 100)

const decodeStatus = (stdout: string, nowMs: number): Status | null => {
  let s: unknown
  try {
    s = JSON.parse(stdout.trim())
  } catch {
    return null
  }
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return null
  const o = s as Record<string, unknown>
  const isIsoInstant = typeof o.asOf === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(o.asOf)
  const asOf = isIsoInstant ? Date.parse(o.asOf as string) : Number.NaN
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
    isInt(o.streakMin, 0, 1500)
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
const BY_WEIGHT = (Object.keys(WEIGHTS) as Part[]).sort((a, b) => WEIGHTS[b] - WEIGHTS[a])

const hourLine = (live: Live | null | undefined): string => {
  const score = live?.score
  if (!live || !score) return 'Nothing scored this hour.'
  const head = `${score.level} ${score.index} this hour`
  const capped = BY_WEIGHT.filter(p => score.parts[p] >= WEIGHTS[p])
  if (capped.length > 0) return `${head}, at the cap: ${capped.map(p => PHRASE[p](live)).join(', ')}.`
  const top = BY_WEIGHT.reduce((a, b) => (score.parts[b] / WEIGHTS[b] > score.parts[a] / WEIGHTS[a] ? b : a))
  return `${head}, mostly ${PHRASE[top](live)}.`
}

type Day = { live?: Live | null; asOf?: string; presence?: { lastAt: string; streakStartAt: string } | null }

const withBandStreak = (day: Day): Live | null | undefined => {
  if (!day.live || !day.presence || !day.asOf) return day.live
  const asOf = Date.parse(day.asOf)
  const minutes = Math.round((asOf - Date.parse(day.presence.streakStartAt)) / 60_000)
  if (!(asOf - Date.parse(day.presence.lastAt) <= REST_MS) || !Number.isFinite(minutes)) return day.live
  return { ...day.live, streakMin: minutes }
}

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

const streakStart = (s: Status): number => Date.parse(s.asOf) - s.streakMin * 60_000

const streakWouldRest = async ($: EngineInterface, s: Status): Promise<boolean> => {
  const spent = await $.store.get('spent')
  return typeof spent !== 'number' || Math.abs(streakStart(s) - spent) > REST_MS
}

const startRestIfDue = async ($: EngineInterface, s: Status) => {
  if (s.streakMin < REST_AFTER_MIN && s.level !== 'Fried') return
  if (!(await streakWouldRest($, s))) return
  const now = await $.clock.now()
  const until = now + REST_MS
  await $.store.set('restUntil', until)
  await $.store.set('rests', [...(await restsSince($, now - WEEK_MS)), now])
  await $.store.set('spent', streakStart(s))
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
  const rests = (await restsSince($, now - WEEK_MS)).length
  const overrides = await overridesSince($, now - WEEK_MS)
  if (rests === 0 && overrides.length === 0) return null
  const newest = overrides.at(-1)
  const reason = newest === undefined ? '' : ` ("${newest.reason}")`
  return `This week: ${plural(rests, 'rest')}, ${plural(overrides.length, 'override')}${reason}.`
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

const refresh = async ($: EngineInterface) => {
  const r = await run($, ['status'])
  const decoded = typeof r === 'string' || r.exitCode !== 0 ? null : decodeStatus(r.stdout, await $.clock.now())
  if (decoded === null) {
    const failure = typeof r === 'string' ? r : r.exitCode === 0 ? 'bad line' : `exit ${r.exitCode}`
    $.ui.log(failure, { to: 'debug' })
    if (failure === 'not found') await toastOnce($, 'missingShown', MISSING)
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
    await $.command.register({ name: 'cogload', description: "What drives this hour's load, and the week's rests and overrides" })
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
    const week = await weekLine($, await $.clock.now())
    return { text: [hourLine(withBandStreak(day as Day)), ...(week === null ? [] : [week])].join('\n') }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!HELD.includes(e.origin.kind)) return next(e)
    const now = await $.clock.now()
    const until = await restUntil($, now)
    if (until === null) return next(e)
    const [first, ...body] = e.text.split('\n')
    const override = OVERRIDE.exec(first)
    const reason = override?.[1].trim() ?? ''
    if (reason.split(/\s+/).length >= 3) {
      await $.store.delete('restUntil')
      await $.store.set('overrides', [...(await overridesSince($, now - WEEK_MS)), { at: now, reason }])
      const text = body.join('\n').trim()
      return text === '' ? { drop: 'Rest lifted.' } : next({ ...e, text })
    }
    const isComposer = e.origin.kind === 'composer'
    if (isComposer) await $.prompt.fill({ text: e.text, mode: 'replace' }).catch(() => {})
    const saved = isComposer ? ' Your prompt is saved.' : ''
    if (override !== null) return { drop: `${SHORT}${saved}` }
    const isTaught = (await $.store.get('taught')) === true
    if (!isTaught) await $.store.set('taught', true)
    return { drop: `Rest until ${clockTime(until)}.${saved}${isTaught ? '' : HINT}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, status)
    if (e.props.hasSurvey || s === null || s.index === null || s.level === null) return next(e)
    const now = await $.clock.now()
    const until = await restUntil($, now)
    const isWarning =
      until === null && s.streakMin >= WARN_AFTER_MIN && s.streakMin < REST_AFTER_MIN && (await streakWouldRest($, s))
    const parts: string[] = []
    if (until !== null) parts.push(`rest until ${clockTime(until)} (${Math.ceil((until - now) / 60_000)} min)`)
    else if (isWarning) parts.push(`rest in ${REST_AFTER_MIN - s.streakMin} min`)
    else if (e.props.bodyColumns >= NARROW && s.streakMin > 0) parts.push(`streak ${formatMinutes(s.streakMin)}`)
    const { Box, Text } = $.ui.resolve(e)
    const head = Text({ color: COLOR[s.level], children: `● ${s.level}` })
    if (parts.length === 0) return head
    return Box({ children: [head, Text({ dimColor: true, children: parts.map(p => ` · ${p}`).join('') })] })
  })
}
