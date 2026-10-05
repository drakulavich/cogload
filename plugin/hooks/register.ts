import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Level, Status } from '../types'

const status = atom({ plugin: 'cognitive-load', key: 'status' } as const, null)

const LEVELS = ['Calm', 'Warming', 'Heating', 'Fried'] as const
const GLYPH: Record<Level, string> = { Calm: '░', Warming: '▒', Heating: '▓', Fried: '█' }
const COLOR: Record<Level, string> = { Calm: 'green', Warming: 'yellow', Heating: '#ff8700', Fried: 'red' }
const NARROW = 50
const CLOCK_SKEW_MS = 60_000
const REST_AFTER_MIN = 40 // NORMS.streakMin in src/lib/metrics/score.ts
const WARN_AFTER_MIN = 35
const REST_MS = 10 * 60_000 // GAP_MS in src/lib/metrics
const HELD: readonly string[] = ['composer', 'bridge']
const WEEK_MS = 7 * 24 * 60 * 60_000
const KEEP_OVERRIDES_MS = 2 * WEEK_MS
const OVERRIDE = /^override:(.*)$/
const HINT = ' To go on now, start the prompt with "override: <reason>".'
const WELCOME = 'cognitive-load shows your load above the prompt when it rises above Calm.'
const MISSING = "cognitive-load needs cogload on Claude Code's PATH: bun add -g @drakulavich/cogload"

type Override = { at: number; reason: string }

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

const formatMinutes = (min: number): string =>
  min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`

const clockTime = (ms: number): string => new Date(ms).toTimeString().slice(0, 5)

const restUntil = async ($: EngineInterface, now: number): Promise<number | null> => {
  const until = await $.store.get('restUntil')
  return typeof until === 'number' && now < until ? until : null
}

const overridesSince = async ($: EngineInterface, since: number): Promise<Override[]> => {
  const list = await $.store.get('overrides')
  return Array.isArray(list) ? (list as Override[]).filter(o => o.at > since) : []
}

const when = (ms: number): string => {
  const [weekday, month, day] = new Date(ms).toDateString().split(' ')
  return `${weekday} ${day} ${month} ${clockTime(ms)}`
}

const streakStart = (s: Status): number => Date.parse(s.asOf) - s.streakMin * 60_000

const streakWouldRest = async ($: EngineInterface, s: Status): Promise<boolean> => {
  const spent = await $.store.get('spent')
  return typeof spent !== 'number' || Math.abs(streakStart(s) - spent) > REST_MS
}

const startRestIfDue = async ($: EngineInterface, s: Status) => {
  if (s.streakMin < REST_AFTER_MIN && s.level !== 'Fried') return
  if (!(await streakWouldRest($, s))) return
  const until = (await $.clock.now()) + REST_MS
  await $.store.set('restUntil', until)
  await $.store.set('spent', streakStart(s))
  await $.ui.toast(`Rest until ${clockTime(until)}. Streak ${formatMinutes(s.streakMin)}, ${s.level} ${s.index}.`)
}

const toastOnce = async ($: EngineInterface, key: string, text: string) => {
  if ((await $.store.get(key)) === true) return
  await $.store.set(key, true)
  $.ui.toast(text)
}

const RUN_TIMEOUT_MS = 10_000
const REFRESH_MS = 60_000

const take = async ($: EngineInterface, s: Status) => {
  await startRestIfDue($, s)
  await update($, status, () => s)
}

const refresh = async ($: EngineInterface) => {
  let failure = ''
  let decoded: Status | null = null
  const startedAt = await $.clock.now()
  try {
    const r = await $.process.run(['cogload', 'status'], { timeoutMs: RUN_TIMEOUT_MS })
    decoded = r.exitCode === 0 ? decodeStatus(r.stdout, await $.clock.now()) : null
    failure = r.exitCode === 0 ? 'bad line' : `exit ${r.exitCode}`
  } catch {
    failure = (await $.clock.now()) - startedAt >= RUN_TIMEOUT_MS ? 'timeout' : 'not found'
  }
  if (decoded === null) {
    $.ui.log(failure, { to: 'debug' })
    if (failure === 'not found') await toastOnce($, 'missingShown', MISSING)
    return
  }
  await $.store.set('reading', decoded)
  await take($, decoded)
}

const tick = async ($: EngineInterface) => {
  const reading = (await $.store.get('reading')) as Status | undefined
  if (reading !== undefined && (await $.clock.now()) - Date.parse(reading.asOf) < REFRESH_MS) await take($, reading)
  else await refresh($)
}

export const register: Register = on => {
  // Not awaited: the engine holds the turn until these hooks return.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'overrides', description: 'Rest overrides of the last 14 days, with their reasons' })
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

  on('command.run', { command: 'overrides' }, async $ => {
    const list = await overridesSince($, (await $.clock.now()) - KEEP_OVERRIDES_MS)
    if (list.length === 0) return { text: 'No overrides in 14 days.' }
    return { text: list.reverse().map(o => `${when(o.at)}  ${o.reason}`).join('\n') }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!HELD.includes(e.origin.kind)) return next(e)
    const now = await $.clock.now()
    const until = await restUntil($, now)
    if (until === null) return next(e)
    const [first, ...body] = e.text.split('\n')
    const reason = OVERRIDE.exec(first)?.[1].trim() ?? ''
    if (reason.split(/\s+/).length >= 3) {
      await $.store.delete('restUntil')
      await $.store.set('overrides', [...(await overridesSince($, now - KEEP_OVERRIDES_MS)), { at: now, reason }])
      const text = body.join('\n').trim()
      return text === '' ? { drop: 'Rest lifted.' } : next({ ...e, text })
    }
    const isComposer = e.origin.kind === 'composer'
    if (isComposer) await $.prompt.fill({ text: e.text, mode: 'replace' }).catch(() => {})
    const isTaught = (await $.store.get('taught')) === true
    if (!isTaught) await $.store.set('taught', true)
    return { drop: `Rest until ${clockTime(until)}.${isComposer ? ' Your prompt is saved.' : ''}${isTaught ? '' : HINT}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, status)
    if (e.props.hasSurvey || s === null || s.index === null || s.level === null) return next(e)
    const now = await $.clock.now()
    const until = await restUntil($, now)
    const isWarning =
      until === null && s.streakMin >= WARN_AFTER_MIN && s.streakMin < REST_AFTER_MIN && (await streakWouldRest($, s))
    if (until === null && !isWarning && s.level === 'Calm') return next(e)
    const parts: string[] = []
    if (until !== null) parts.push(`rest until ${clockTime(until)} (${Math.ceil((until - now) / 60_000)} min)`)
    else if (isWarning) parts.push(`rest in ${REST_AFTER_MIN - s.streakMin} min`)
    else if (e.props.bodyColumns >= NARROW && s.streakMin > 0) parts.push(`streak ${formatMinutes(s.streakMin)}`)
    const overrides = (await overridesSince($, now - WEEK_MS)).length
    if (overrides > 0) parts.push(`overrides this week: ${overrides}`)
    const { Box, Text } = $.ui.resolve(e)
    const head = Text({ color: COLOR[s.level], children: `${GLYPH[s.level]} ${s.level}` })
    if (parts.length === 0) return head
    return Box({ children: [head, Text({ dimColor: true, children: parts.map(p => ` · ${p}`).join('') })] })
  })
}
