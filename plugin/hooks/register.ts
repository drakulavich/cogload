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
  const asOf = typeof o.asOf === 'string' ? Date.parse(o.asOf) : Number.NaN
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
  return isValid ? (o as Status) : null
}

const formatMinutes = (min: number): string =>
  min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`

const refresh = async ($: EngineInterface) => {
  let failure: string
  try {
    const r = await $.process.run(['zapara', 'status'], { timeoutMs: 10_000 })
    const decoded = r.exitCode === 0 ? decodeStatus(r.stdout, await $.clock.now()) : null
    if (decoded) {
      await update($, status, () => decoded)
      return
    }
    failure = r.exitCode === 0 ? 'bad line' : `exit ${r.exitCode}`
  } catch (err) {
    failure = err instanceof Error && /timed? ?out/i.test(err.message) ? 'timeout' : 'not found'
  }
  $.ui.log(`cognitive-load: ${failure}`, { to: 'debug' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, status)
    if (e.props.hasSurvey || s === null || s.index === null || s.level === null) return next(e)
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
