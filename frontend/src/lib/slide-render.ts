import type { Slide } from './types'

// Draws carousel slides in the browser, so the words are exact and editable
// and the real logo file is used. Mirrors worker/src/platforms.ts. The
// on-screen preview (CarouselSlides.module.css) follows the same layout.
export const SLIDE_WIDTH = 1080
export const SLIDE_HEIGHT = 1350

const PADDING = 96
const FONT = 'Inter, system-ui, sans-serif'

export const SLIDE_COLOURS = {
  offWhite: '#f8fafc',
  white: '#ffffff',
  ink: '#111827',
  body: '#374151',
}

export type SlideKind = 'hook' | 'point' | 'close'

export function slideKind(index: number, total: number): SlideKind {
  if (index === 0) return 'hook'
  return index === total - 1 ? 'close' : 'point'
}

export interface SlideDesign {
  background: string | null
  logo: string | null
  colour: string
}

// A brand colour dark enough to read on white, or near-black when it is
// too pale (a yellow or pastel brand colour).
export function headingColour(hex: string): string {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  // 4.5:1 contrast against white.
  return 1.05 / (luminance + 0.05) >= 4.5 ? hex : SLIDE_COLOURS.ink
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load ${src}`))
    img.src = src
  })
}

// Splits text into lines that fit the width at the context's current font.
export function wrapLines(measure: (text: string) => number, text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && measure(next) > width) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

interface TextBlock {
  lines: string[]
  size: number
  weight: number
  colour: string
  lineHeight: number
}

const HEADING_GAP = 36

function block(ctx: CanvasRenderingContext2D, text: string, style: Omit<TextBlock, 'lines'>): TextBlock {
  ctx.font = `${style.weight} ${style.size}px ${FONT}`
  return { ...style, lines: wrapLines((t) => ctx.measureText(t).width, text, SLIDE_WIDTH - PADDING * 2) }
}

function heightOf(blocks: TextBlock[]): number {
  const filled = blocks.filter((b) => b.lines.length)
  return filled.reduce((sum, b) => sum + b.lines.length * b.size * b.lineHeight, 0) + HEADING_GAP * Math.max(0, filled.length - 1)
}

function drawBlocks(ctx: CanvasRenderingContext2D, blocks: TextBlock[], top: number, align: CanvasTextAlign): void {
  let y = top
  ctx.textBaseline = 'top'
  ctx.textAlign = align
  const x = align === 'center' ? SLIDE_WIDTH / 2 : PADDING
  for (const b of blocks.filter((item) => item.lines.length)) {
    ctx.font = `${b.weight} ${b.size}px ${FONT}`
    ctx.fillStyle = b.colour
    for (const line of b.lines) {
      ctx.fillText(line, x, y)
      y += b.size * b.lineHeight
    }
    y += HEADING_GAP
  }
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement): void {
  const scale = Math.max(SLIDE_WIDTH / img.naturalWidth, SLIDE_HEIGHT / img.naturalHeight)
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  ctx.drawImage(img, (SLIDE_WIDTH - w) / 2, (SLIDE_HEIGHT - h) / 2, w, h)
}

// Slide one: the photograph, darkening towards the bottom where the hook
// sits in large white type.
function drawHook(ctx: CanvasRenderingContext2D, slide: Slide, design: SlideDesign, photo: HTMLImageElement | null): void {
  ctx.fillStyle = design.colour
  ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT)
  if (photo) drawCover(ctx, photo)
  const shade = ctx.createLinearGradient(0, SLIDE_HEIGHT * 0.35, 0, SLIDE_HEIGHT)
  shade.addColorStop(0, 'rgba(15, 23, 42, 0)')
  shade.addColorStop(1, 'rgba(15, 23, 42, 0.88)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT)
  const blocks = [
    block(ctx, slide.heading, { size: 88, weight: 700, colour: SLIDE_COLOURS.white, lineHeight: 1.12 }),
    block(ctx, slide.body, { size: 44, weight: 400, colour: SLIDE_COLOURS.white, lineHeight: 1.4 }),
  ]
  drawBlocks(ctx, blocks, SLIDE_HEIGHT - PADDING - heightOf(blocks), 'left')
}

// The middle slides: one point each on a clean off-white page.
function drawPoint(ctx: CanvasRenderingContext2D, slide: Slide, design: SlideDesign): void {
  ctx.fillStyle = SLIDE_COLOURS.offWhite
  ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT)
  const blocks = [
    block(ctx, slide.heading, { size: 72, weight: 700, colour: headingColour(design.colour), lineHeight: 1.15 }),
    block(ctx, slide.body, { size: 46, weight: 400, colour: SLIDE_COLOURS.body, lineHeight: 1.45 }),
  ]
  drawBlocks(ctx, blocks, (SLIDE_HEIGHT - heightOf(blocks)) / 2, 'left')
}

const LOGO_MAX_WIDTH = 520
const LOGO_MAX_HEIGHT = 240
const LOGO_GAP = 72

// The last slide: the logo at its natural look on white, then the call to
// action, centred.
function drawClose(ctx: CanvasRenderingContext2D, slide: Slide, design: SlideDesign, logo: HTMLImageElement | null): void {
  ctx.fillStyle = SLIDE_COLOURS.white
  ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT)
  const blocks = [
    block(ctx, slide.heading, { size: 72, weight: 700, colour: headingColour(design.colour), lineHeight: 1.15 }),
    block(ctx, slide.body, { size: 46, weight: 400, colour: SLIDE_COLOURS.body, lineHeight: 1.45 }),
  ]
  const scale = logo ? Math.min(LOGO_MAX_WIDTH / logo.naturalWidth, LOGO_MAX_HEIGHT / logo.naturalHeight, 1) : 0
  const logoHeight = logo ? logo.naturalHeight * scale + LOGO_GAP : 0
  const top = (SLIDE_HEIGHT - logoHeight - heightOf(blocks)) / 2
  if (logo) {
    const w = logo.naturalWidth * scale
    ctx.drawImage(logo, (SLIDE_WIDTH - w) / 2, top, w, logo.naturalHeight * scale)
  }
  drawBlocks(ctx, blocks, top + logoHeight, 'center')
}

// One finished slide as a PNG.
export async function renderSlide(design: SlideDesign, slides: Slide[], index: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = SLIDE_WIDTH
  canvas.height = SLIDE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  await Promise.all([document.fonts?.load(`700 72px Inter`), document.fonts?.load(`400 46px Inter`)]).catch(() => undefined)
  const slide = slides[index]!
  const kind = slideKind(index, slides.length)
  if (kind === 'hook') {
    drawHook(ctx, slide, design, design.background ? await loadImage(design.background) : null)
  } else if (kind === 'point') {
    drawPoint(ctx, slide, design)
  } else {
    drawClose(ctx, slide, design, design.logo ? await loadImage(design.logo).catch(() => null) : null)
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not export slide'))), 'image/png')
  })
}

// Starts a browser download of a blob.
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
