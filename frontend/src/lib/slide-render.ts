import type { Slide } from './types'

// Draws carousel slides in the browser, so the words are exact and editable
// and the real logo file is used. Mirrors worker/src/platforms.ts.
export const SLIDE_WIDTH = 1080
export const SLIDE_HEIGHT = 1350

const PADDING = 96
const FONT = 'Inter, system-ui, sans-serif'

export interface SlideDesign {
  background: string | null
  logo: string | null
  colour: string
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

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement): void {
  const scale = Math.max(SLIDE_WIDTH / img.naturalWidth, SLIDE_HEIGHT / img.naturalHeight)
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  ctx.drawImage(img, (SLIDE_WIDTH - w) / 2, (SLIDE_HEIGHT - h) / 2, w, h)
}

function drawLogo(ctx: CanvasRenderingContext2D, img: HTMLImageElement): void {
  const maxW = 260
  const maxH = 110
  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight)
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  const pad = 20
  const x = PADDING - pad
  const y = SLIDE_HEIGHT - PADDING - h - pad
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(x, y, w + pad * 2, h + pad * 2, 16)
  ctx.fill()
  ctx.drawImage(img, x + pad, y + pad, w, h)
}

function drawText(ctx: CanvasRenderingContext2D, slide: Slide, first: boolean): void {
  const width = SLIDE_WIDTH - PADDING * 2
  const headingSize = first ? 96 : 76
  ctx.font = `700 ${headingSize}px ${FONT}`
  const heading = wrapLines((t) => ctx.measureText(t).width, slide.heading, width)
  ctx.font = `400 46px ${FONT}`
  const body = wrapLines((t) => ctx.measureText(t).width, slide.body, width)
  const headingLine = headingSize * 1.15
  const bodyLine = 46 * 1.4
  const total = heading.length * headingLine + (body.length ? 40 + body.length * bodyLine : 0)
  let y = (SLIDE_HEIGHT - total) / 2
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'top'
  ctx.font = `700 ${headingSize}px ${FONT}`
  for (const line of heading) {
    ctx.fillText(line, PADDING, y)
    y += headingLine
  }
  y += 40
  ctx.font = `400 46px ${FONT}`
  for (const line of body) {
    ctx.fillText(line, PADDING, y)
    y += bodyLine
  }
}

// One finished slide as a PNG: the background, a dark wash so white text
// always reads, a brand-coloured bar, the words, the slide number and the
// logo on a white tab.
export async function renderSlide(design: SlideDesign, slides: Slide[], index: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = SLIDE_WIDTH
  canvas.height = SLIDE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  await document.fonts.load(`700 76px Inter`).catch(() => undefined)
  const [background, logo] = await Promise.all([
    design.background ? loadImage(design.background) : null,
    design.logo ? loadImage(design.logo).catch(() => null) : null,
  ])
  ctx.fillStyle = design.colour
  ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT)
  if (background) drawCover(ctx, background)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.55)'
  ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT)
  ctx.fillStyle = design.colour
  ctx.fillRect(0, 0, SLIDE_WIDTH, 24)
  const slide = slides[index]!
  drawText(ctx, slide, index === 0)
  ctx.font = `600 36px ${FONT}`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.textAlign = 'right'
  ctx.fillText(`${index + 1}/${slides.length}`, SLIDE_WIDTH - PADDING, PADDING)
  ctx.textAlign = 'left'
  if (logo) drawLogo(ctx, logo)
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
