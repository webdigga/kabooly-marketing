import type { Look } from './types'

const KEY = 'kabooly-marketing-look'

export const DEFAULT_LOOK: Look = { style: 'photo', logo: false }

// Remembers the look chosen last time, per browser. Anything missing or
// unreadable means a photograph with the brand strip.
export function loadLook(): Look {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (saved && typeof saved === 'object') {
      const { style, logo } = saved as Partial<Look>
      return { style: style === 'graphic' ? 'graphic' : 'photo', logo: logo === true }
    }
  } catch {
    // Storage blocked or corrupt: fall through to the default.
  }
  return DEFAULT_LOOK
}

export function saveLook(look: Look): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(look))
  } catch {
    // Not remembering is fine.
  }
}
