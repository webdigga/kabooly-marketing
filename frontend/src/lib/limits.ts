import { ApiError } from './api'
import type { Allowance, Usage } from './types'

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

// Turns an ISO instant into "3:42pm", "3:42pm tomorrow" or "3:42pm on
// Tue 23 Sep" in the viewer's own time zone.
export function localTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  const time = at
    .toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(' ', '')
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000)
  if (days <= 0) return time
  if (days === 1) return `${time} tomorrow`
  const date = at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${time} on ${date}`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

interface LimitBody {
  retryAt?: string
  nextFreeAt?: string
  remaining?: number
  limit?: number
}

function imageLimit(window: 'today' | 'this month', body: LimitBody, now: Date): string {
  const { nextFreeAt = '', remaining = 0, limit = 20 } = body
  const when = localTime(nextFreeAt, now)
  if (remaining > 0) {
    return `You have ${plural(remaining, 'image')} left ${window}. Tick fewer platforms, or wait until ${when} for more.`
  }
  const period = window === 'today' ? '24 hours' : '30 days'
  return `You have made all ${limit} images allowed in ${period}. Your next image is available at ${when}.`
}

// Explains a 429 from any generation endpoint, or returns null for other
// errors so the caller can show its own message.
export function limitMessage(err: unknown, now: Date = new Date()): string | null {
  if (!(err instanceof ApiError) || err.status !== 429) return null
  const { code, retryAt = '', nextFreeAt = '', limit = 20 } = err.body
  switch (code) {
    case 'busy':
      return 'Another advert is still being made. Wait for it to finish, then try again.'
    case 'rate_limit':
      return `That is a lot of adverts in one minute. Try again at ${localTime(retryAt, now)}.`
    case 'daily_image_limit':
      return imageLimit('today', err.body, now)
    case 'monthly_image_limit':
      return imageLimit('this month', err.body, now)
    case 'monthly_video_limit':
      return `You have made all ${limit} videos allowed in 30 days. Your next video is available at ${localTime(nextFreeAt, now)}.`
    case 'daily_text_limit':
      return `You have reached today's limit for text. More is available at ${localTime(nextFreeAt, now)}.`
    default:
      return 'Too many requests. Try again shortly.'
  }
}

export interface UsageRow {
  label: string
  left: string
  // Set once the allowance is used up.
  freeAt: string | null
}

function row(label: string, allowance: Allowance, unit: string, now: Date): UsageRow {
  const left = Math.max(0, allowance.limit - allowance.used)
  return {
    label,
    left: `${left} of ${plural(allowance.limit, unit)} left`,
    freeAt: left === 0 && allowance.nextFreeAt ? `More from ${localTime(allowance.nextFreeAt, now)}` : null,
  }
}

// What the account has left, most pressing first.
export function usageRows(usage: Usage, now: Date = new Date()): UsageRow[] {
  return [
    row('Images today', usage.imagesToday, 'image', now),
    row('Images this month', usage.imagesThisMonth, 'image', now),
    row('Videos this month', usage.videosThisMonth, 'video', now),
  ]
}
