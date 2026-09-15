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
  instagram: { id: 'instagram', label: 'Instagram', shape: 'Square', width: 1080, height: 1080 },
  facebook: { id: 'facebook', label: 'Facebook', shape: 'Landscape', width: 1200, height: 630 },
  nextdoor: { id: 'nextdoor', label: 'Nextdoor', shape: 'Square', width: 1200, height: 1200 },
}

export const PLATFORMS: PlatformInfo[] = Object.values(PLATFORM_INFO)
