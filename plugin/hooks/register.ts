import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Level, Status } from '../types'

const status = atom({ plugin: 'cognitive-load', key: 'status' } as const, null)

const LEVELS = ['Calm', 'Warming', 'Heating', 'Fried'] as const
const GLYPH: Record<Level, string> = { Calm: '░', Warming: '▒', Heating: '▓', Fried: '█' }
const COLOR: Record<Level, string> = { Calm: 'green', Warming: 'yellow', Heating: 'magenta', Fried: 'red' }
const NARROW = 50
const CLOCK_SKEW_MS = 60_000

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

const RUN_TIMEOUT_MS = 10_000

const refresh = async ($: EngineInterface) => {
  let failure: string
  const startedAt = await $.clock.now()
  try {
    const r = await $.process.run(['zapara', 'status'], { timeoutMs: RUN_TIMEOUT_MS })
    const decoded = r.exitCode === 0 ? decodeStatus(r.stdout, await $.clock.now()) : null
    if (decoded) {
      await update($, status, () => decoded)
      return
    }
    failure = r.exitCode === 0 ? 'bad line' : `exit ${r.exitCode}`
  } catch {
    failure = (await $.clock.now()) - startedAt >= RUN_TIMEOUT_MS ? 'timeout' : 'not found'
  }
  $.ui.log(failure, { to: 'debug' })
}

export const register: Register = on => {
  // Not awaited: the engine holds the turn until these hooks return.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    refresh($).catch(() => {})
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    refresh($).catch(() => {})
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, status)
    if (e.props.hasSurvey || s === null || s.index === null || s.level === null || s.level === 'Calm') return next(e)
    const parts = [`${GLYPH[s.level]} ${s.level} ${s.index}`]
    if (e.props.bodyColumns >= NARROW) {
      if (s.peak !== null) parts.push(`peak ${s.peak}`)
      if (s.streakMin > 0) parts.push(`streak ${formatMinutes(s.streakMin)}`)
      parts.push(`active ${formatMinutes(s.activeMin)}`)
    }
    const { Text } = $.ui.resolve(e)
    return Text({ color: COLOR[s.level], children: parts.join(' · ') })
  })
}
