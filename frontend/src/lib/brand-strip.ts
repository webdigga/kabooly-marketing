import { api } from './api'

// The strip of branding stamped along the bottom of every generated image:
// the real logo file and the website address, drawn here in the browser
// (where the fonts are) and stored with the profile. Mirrors STRIP_SHARE in
// worker/src/image-maker.ts: 12% of a 1200 wide image.
export const STRIP_WIDTH = 1200
export const STRIP_HEIGHT = 144
const EDGE = 8
const PADDING = 32
const FONT = 'Inter, system-ui, sans-serif'

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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load ${src}`))
    img.src = src
  })
}

async function draw(input: BrandStripInput): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = STRIP_WIDTH
  canvas.height = STRIP_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const colour = input.colour ?? '#1d4ed8'
  ctx.fillStyle = colour
  ctx.fillRect(0, 0, STRIP_WIDTH, STRIP_HEIGHT)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, EDGE, STRIP_WIDTH, STRIP_HEIGHT - EDGE)

  const website = websiteLabel(input.websiteUrl)
  if (website) {
    // Older browsers (and test environments) have no font loading API.
    await document.fonts?.load(`600 44px Inter`).catch(() => undefined)
    ctx.font = `600 44px ${FONT}`
    ctx.fillStyle = colour
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(website, STRIP_WIDTH - PADDING, STRIP_HEIGHT / 2 + EDGE / 2)
  }
  if (input.logoUrl) {
    const logo = await loadImage(input.logoUrl)
    const maxHeight = STRIP_HEIGHT - EDGE - 32
    const maxWidth = website ? STRIP_WIDTH / 2 : STRIP_WIDTH - PADDING * 2
    const scale = Math.min(maxWidth / logo.naturalWidth, maxHeight / logo.naturalHeight)
    ctx.drawImage(logo, PADDING, EDGE + (STRIP_HEIGHT - EDGE - logo.naturalHeight * scale) / 2, logo.naturalWidth * scale, logo.naturalHeight * scale)
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

// The strip for a profile, or null when there is nothing to put on it (no
// logo and no website) or the browser could not draw it.
export async function makeBrandStrip(input: BrandStripInput): Promise<Blob | null> {
  if (!input.logoUrl && !websiteLabel(input.websiteUrl)) return null
  try {
    return await draw(input)
  } catch {
    return null
  }
}

// Draws and stores the strip, returning its key for the profile. A failure
// leaves the account without a strip rather than blocking the save.
export async function uploadBrandStrip(input: BrandStripInput): Promise<string | null> {
  const blob = await makeBrandStrip(input)
  if (!blob) return null
  try {
    const { key } = await api<{ key: string }>('/api/uploads/brand-strip', { blob })
    return key
  } catch {
    return null
  }
}
