import { api } from './api'
import { PLATFORMS } from './platforms'
import type { Platform } from './types'

// The strip of branding stamped along the bottom of every image: the real
// logo file and the website address, drawn here in the browser (where the
// fonts are) and stored with the profile, one per platform at that
// platform's exact size. Mirrors stripSize in worker/src/platforms.ts.
const STRIP_SHARE = 0.09
const FONT = 'Inter, system-ui, sans-serif'

export function stripSize(platform: Platform): { width: number; height: number } {
  const { width } = PLATFORMS.find((p) => p.id === platform) ?? { width: 1200 }
  return { width, height: Math.round(width * STRIP_SHARE) }
}

export interface BrandStripInput {
  logoUrl: string | null
  colour: string | null
  websiteUrl: string
}

// "https://www.acme.co.uk/about" reads as "acme.co.uk" on an advert.
export function websiteLabel(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  return trimmed
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .slice(0, 60)
}

const LOAD_TIMEOUT_MS = 10_000

// Never waits for ever: a logo that will not load must not block a save.
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const fail = () => reject(new Error(`could not load ${src}`))
    const timer = setTimeout(fail, LOAD_TIMEOUT_MS)
    img.onload = () => {
      clearTimeout(timer)
      resolve(img)
    }
    img.onerror = fail
    img.src = src
  })
}

async function draw(input: BrandStripInput, platform: Platform, logo: HTMLImageElement | null): Promise<Blob | null> {
  const { width, height } = stripSize(platform)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const colour = input.colour ?? '#1d4ed8'
  const edge = Math.max(3, Math.round(height * 0.07))
  const padding = Math.round(height * 0.3)
  ctx.fillStyle = colour
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, edge, width, height - edge)

  const website = websiteLabel(input.websiteUrl)
  const middle = edge + (height - edge) / 2
  let textWidth = 0
  if (website) {
    const size = Math.round((height - edge) * 0.34)
    await document.fonts?.load(`600 ${String(size)}px Inter`).catch(() => undefined)
    ctx.font = `600 ${String(size)}px ${FONT}`
    ctx.fillStyle = colour
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(website, width - padding, middle)
    textWidth = ctx.measureText(website).width + padding * 2
  }
  if (logo) {
    const maxHeight = height - edge - padding
    const maxWidth = width - textWidth - padding * 2
    const scale = Math.min(maxWidth / logo.naturalWidth, maxHeight / logo.naturalHeight)
    const w = logo.naturalWidth * scale
    const h = logo.naturalHeight * scale
    ctx.drawImage(logo, padding, middle - h / 2, w, h)
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

// A strip for each platform, or null when there is nothing to put on one
// (no logo and no website) or the browser could not draw it.
export async function makeBrandStrips(input: BrandStripInput): Promise<Partial<Record<Platform, Blob>>> {
  if (!input.logoUrl && !websiteLabel(input.websiteUrl)) return {}
  try {
    const logo = input.logoUrl ? await loadImage(input.logoUrl) : null
    const strips = await Promise.all(PLATFORMS.map(async (p) => [p.id, await draw(input, p.id, logo)] as const))
    return Object.fromEntries(strips.filter(([, blob]) => blob !== null))
  } catch {
    return {}
  }
}

// Draws and stores the strips, returning their keys for the profile. A
// failure leaves the account without strips rather than blocking the save.
export async function uploadBrandStrips(input: BrandStripInput): Promise<Partial<Record<Platform, string>>> {
  const strips = Object.entries(await makeBrandStrips(input))
  if (!strips.length) return {}
  try {
    const stored = await Promise.all(
      strips.map(async ([platform, blob]) => {
        const { key } = await api<{ key: string }>('/api/uploads/brand-strip', { blob })
        return [platform, key] as const
      }),
    )
    return Object.fromEntries(stored)
  } catch {
    return {}
  }
}
