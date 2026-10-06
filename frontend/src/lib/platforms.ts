import type { Platform } from './types'

export interface PlatformInfo {
  id: Platform
  label: string
  shape: string
  width: number
  height: number
}

// Mirrors worker/src/platforms.ts.
export const PLATFORM_INFO: Record<Platform, PlatformInfo> = {
  instagram: { id: 'instagram', label: 'Instagram', shape: 'Portrait', width: 1440, height: 1800 },
  facebook: { id: 'facebook', label: 'Facebook', shape: 'Portrait', width: 1440, height: 1800 },
  nextdoor: { id: 'nextdoor', label: 'Nextdoor', shape: 'Square', width: 1200, height: 1200 },
  google: { id: 'google', label: 'Google', shape: 'Square', width: 1200, height: 1200 },
  story: { id: 'story', label: 'Instagram Story', shape: 'Full screen', width: 1080, height: 1920 },
}

export const PLATFORMS: PlatformInfo[] = Object.values(PLATFORM_INFO)

// A Story is composed whole in the browser, branding included, so it needs
// no stored strip file.
export const STRIP_PLATFORMS: PlatformInfo[] = PLATFORMS.filter((p) => p.id !== 'story')

// Ticked the first time someone lands on the create screen. Google posts
// and Stories are opt in: not every business has a Google listing, and a
// Story lasts a day, so neither should quietly use up an image.
export const DEFAULT_PLATFORMS: PlatformInfo[] = PLATFORMS.filter((p) => p.id !== 'story' && p.id !== 'google')
