import { drawStrip, stripSize, websiteLabel } from './brand-strip'
import { PLATFORM_INFO } from './platforms'
import type { StoryWords } from './types'

// Draws the finished Instagram Story in the browser: the photo, the words
// and the brand strip, laid out clear of the areas Instagram covers with
// its own controls (the account name across the top, the reply bar across
// the bottom). The words are exact because they are drawn here, not by an
// AI, and the logo is the customer's real file.
export const STORY_WIDTH = PLATFORM_INFO.story.width
export const STORY_HEIGHT = PLATFORM_INFO.story.height

// Instagram lays its reply bar across the bottom of a Story, so nothing is
// drawn in the last of it.
export const SAFE_BOTTOM = 250
const PADDING = 80
const FONT = 'Inter, system-ui, sans-serif'

export interface StoryDesign {
  photo: string
  logo: string | null
  colour: string
  websiteUrl: string
}

// The brand strip sits just above the reply bar, so the bottom of the words
// is the top of the strip.
export const STRIP_HEIGHT = stripSize('story').height
const STRIP_GAP = 48

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load ${src}`))
    img.src = src
  })
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
  const size = 46
  ctx.font = `600 ${String(size)}px ${FONT}`
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

  const shade = ctx.createLinearGradient(0, STORY_HEIGHT * 0.35, 0, STORY_HEIGHT)
  shade.addColorStop(0, 'rgba(15, 23, 42, 0)')
  shade.addColorStop(1, 'rgba(15, 23, 42, 0.9)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT)

  const branded = Boolean(logo) || Boolean(websiteLabel(design.websiteUrl))
  if (branded) {
    const top = STORY_HEIGHT - SAFE_BOTTOM - STRIP_HEIGHT
    await drawStrip(ctx, { x: 0, y: top, width: STORY_WIDTH, height: STRIP_HEIGHT }, design, logo)
  }

  const ctaBottom = STORY_HEIGHT - SAFE_BOTTOM - (branded ? STRIP_HEIGHT + STRIP_GAP : 0)
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
