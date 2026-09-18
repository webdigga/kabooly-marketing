import { websiteLabel } from './brand-strip'
import { PLATFORM_INFO } from './platforms'
import type { StoryWords } from './types'

// Draws the finished Instagram Story in the browser: the photo, the words
// and the branding, laid out clear of the areas Instagram covers with its
// own controls. The words are exact because they are drawn here, not by an
// AI, and the logo is the customer's real file.
export const STORY_WIDTH = PLATFORM_INFO.story.width
export const STORY_HEIGHT = PLATFORM_INFO.story.height

// Instagram lays its reply bar across the bottom of a Story, so nothing is
// drawn in the last of it.
export const SAFE_BOTTOM = 250
const PADDING = 80
const FONT = 'Inter, system-ui, sans-serif'

// A Story is tall, so its branding is a proper lockup at the foot of the
// image rather than the thin strip a square advert carries.
const LOGO_MAX_WIDTH = 460
const LOGO_MAX_HEIGHT = 210
const WEBSITE_SIZE = 44
const LOCKUP_GAP = 28
const CARD_PADDING = 30
const CTA_GAP = 60

export interface StoryDesign {
  photo: string
  logo: string | null
  colour: string
  websiteUrl: string
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load ${src}`))
    img.src = src
  })
}

// How light the visible pixels of a logo are, 0 (black) to 1 (white). A
// logo that cannot be measured is treated as dark, which is the safe way
// round: it gets a white card to sit on.
export function logoBrightness(img: HTMLImageElement): number {
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return 0
  ctx.drawImage(img, 0, 0, size, size)
  let light = 0
  let seen = 0
  try {
    const { data } = ctx.getImageData(0, 0, size, size)
    for (let i = 0; i < data.length; i += 4) {
      const alpha = (data[i + 3] ?? 0) / 255
      if (alpha < 0.3) continue
      seen += 1
      light += (0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0)) / 255
    }
  } catch {
    return 0
  }
  return seen ? light / seen : 0
}

// The bottom of a Story is darkened, so a light logo sits straight on the
// photo and only a dark one needs a card behind it.
export function needsCard(img: HTMLImageElement): boolean {
  return logoBrightness(img) < 0.55
}

export async function loadLogoForStory(src: string): Promise<boolean> {
  try {
    return needsCard(await loadImage(src))
  } catch {
    return true
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > width) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement): void {
  const scale = Math.max(STORY_WIDTH / img.naturalWidth, STORY_HEIGHT / img.naturalHeight)
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  ctx.drawImage(img, (STORY_WIDTH - w) / 2, (STORY_HEIGHT - h) / 2, w, h)
}

function drawCta(ctx: CanvasRenderingContext2D, cta: string, colour: string, bottom: number): void {
  ctx.font = `600 46px ${FONT}`
  const width = ctx.measureText(cta).width + 80
  const height = 108
  const left = (STORY_WIDTH - width) / 2
  const top = bottom - height
  ctx.fillStyle = colour
  ctx.beginPath()
  ctx.roundRect(left, top, width, height, height / 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(cta, STORY_WIDTH / 2, top + height / 2)
}

function drawLogo(ctx: CanvasRenderingContext2D, logo: HTMLImageElement, bottom: number): number {
  const scale = Math.min(LOGO_MAX_WIDTH / logo.naturalWidth, LOGO_MAX_HEIGHT / logo.naturalHeight)
  const w = logo.naturalWidth * scale
  const h = logo.naturalHeight * scale
  const left = (STORY_WIDTH - w) / 2
  const top = bottom - h
  if (needsCard(logo)) {
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.roundRect(left - CARD_PADDING, top - CARD_PADDING, w + CARD_PADDING * 2, h + CARD_PADDING * 2, 28)
    ctx.fill()
  }
  ctx.drawImage(logo, left, top, w, h)
  return needsCard(logo) ? top - CARD_PADDING : top
}

// The logo and web address at the foot of the Story. Returns the top of
// the branding, which is where the words above it stop.
function drawLockup(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null, website: string, bottom: number): number {
  let top = bottom
  if (website) {
    ctx.font = `600 ${String(WEBSITE_SIZE)}px ${FONT}`
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(website, STORY_WIDTH / 2, bottom)
    top = bottom - WEBSITE_SIZE - LOCKUP_GAP
  }
  return logo ? drawLogo(ctx, logo, top) : top
}

// The finished Story as a PNG blob.
export async function renderStory(design: StoryDesign, words: StoryWords): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = STORY_WIDTH
  canvas.height = STORY_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  await document.fonts?.load(`700 76px Inter`).catch(() => undefined)
  const [photo, logo] = await Promise.all([
    loadImage(design.photo),
    design.logo ? loadImage(design.logo).catch(() => null) : null,
  ])
  cover(ctx, photo)

  const shade = ctx.createLinearGradient(0, STORY_HEIGHT * 0.3, 0, STORY_HEIGHT)
  shade.addColorStop(0, 'rgba(15, 23, 42, 0)')
  shade.addColorStop(1, 'rgba(15, 23, 42, 0.92)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT)

  const lockupTop = drawLockup(ctx, logo, websiteLabel(design.websiteUrl), STORY_HEIGHT - SAFE_BOTTOM)
  const ctaBottom = lockupTop - CTA_GAP
  drawCta(ctx, words.cta, design.colour, ctaBottom)

  ctx.font = `700 76px ${FONT}`
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const lines = wrap(ctx, words.headline, STORY_WIDTH - PADDING * 2)
  let y = ctaBottom - 200 - (lines.length - 1) * 88
  for (const line of lines) {
    ctx.fillText(line, PADDING, y)
    y += 88
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not export the story'))), 'image/png')
  })
}
