import { ApiError } from './api'

// Turns an ISO instant into "3:42pm" or "3:42pm tomorrow" in the viewer's
// own time zone.
export function localTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  const time = at
    .toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(' ', '')
  const sameDay = at.toDateString() === now.toDateString()
  return sameDay ? time : `${time} tomorrow`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// Explains a 429 from any generation endpoint, or returns null for other
// errors so the caller can show its own message.
export function limitMessage(err: unknown, now: Date = new Date()): string | null {
  if (!(err instanceof ApiError) || err.status !== 429) return null
  const { code, retryAt, nextFreeAt, remaining = 0, limit = 20 } = err.body
  switch (code) {
    case 'busy':
      return 'Another advert is still being made. Wait for it to finish, then try again.'
    case 'rate_limit':
      return `That is a lot of adverts in one minute. Try again at ${localTime(retryAt ?? '', now)}.`
    case 'daily_image_limit':
      if (remaining > 0) {
        return `You have ${plural(remaining, 'image')} left today. Tick fewer platforms, or wait until ${localTime(nextFreeAt ?? '', now)} for more.`
      }
      return `You have made all ${limit} images allowed in 24 hours. Your next image is available at ${localTime(nextFreeAt ?? '', now)}.`
    case 'daily_text_limit':
      return `You have reached today's limit for text. More is available at ${localTime(nextFreeAt ?? '', now)}.`
    default:
      return 'Too many requests. Try again shortly.'
  }
}

export function usageLine(imagesUsed: number, imagesLimit: number): string {
  const left = Math.max(0, imagesLimit - imagesUsed)
  return `${plural(left, 'image')} left today (${imagesLimit} per 24 hours)`
}
