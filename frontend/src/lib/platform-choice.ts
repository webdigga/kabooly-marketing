import { PLATFORMS, STRIP_PLATFORMS } from './platforms'
import type { Platform } from './types'

const KEY = 'kabooly-marketing-platforms'
const ALL = PLATFORMS.map((p) => p.id)
// Stories are opt in: they last 24 hours, so not everyone wants one.
const DEFAULT = STRIP_PLATFORMS.map((p) => p.id)

// Remembers which platforms were ticked last time, per browser. A missing
// or unreadable value means the three feed posts.
export function loadPlatformChoice(): Platform[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (Array.isArray(saved)) return ALL.filter((p) => saved.includes(p))
  } catch {
    // Storage blocked or corrupt: fall through to the default.
  }
  return DEFAULT
}

export function savePlatformChoice(platforms: Platform[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(platforms))
  } catch {
    // Not remembering is fine.
  }
}
