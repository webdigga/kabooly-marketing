// Logos come from anywhere: a proper transparent PNG, or a site's app icon
// with the mark sitting on a solid square. This tidies whatever turns up
// into one shape: a flat background dropped to transparency, and the empty
// margins cut off, so everything downstream can treat a logo as a logo.

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

// How far a pixel may drift from the background colour and still count as
// background (0 to 255 per channel).
const TOLERANCE = 14
const OPAQUE = 250
// Only a border this consistent is treated as a background to remove.
const CORNER_TOLERANCE = 10

function at(data: Uint8ClampedArray, i: number): [number, number, number, number] {
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0]
}

function near(a: [number, number, number, number], b: [number, number, number, number], tolerance: number): boolean {
  return Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance && Math.abs(a[2] - b[2]) <= tolerance
}

export function hasTransparency(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 0) < OPAQUE) return true
  }
  return false
}

// The colour every corner shares, or null when they disagree (a photo, or
// a logo that runs to the edge, neither of which should be touched).
export function backgroundColour(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number, number] | null {
  const corners = [
    at(data, 0),
    at(data, (width - 1) * 4),
    at(data, (height - 1) * width * 4),
    at(data, ((height - 1) * width + width - 1) * 4),
  ]
  const [first] = corners as [[number, number, number, number]]
  return corners.every((c) => near(c, first, CORNER_TOLERANCE)) ? first : null
}

// Clears the background where it touches an edge, so a colour used inside
// the mark itself is kept.
function clearBackground(data: Uint8ClampedArray, width: number, height: number, colour: [number, number, number, number]): void {
  const seen = new Uint8Array(width * height)
  const queue: number[] = []
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const p = y * width + x
    if (seen[p]) return
    seen[p] = 1
    if (!near(at(data, p * 4), colour, TOLERANCE)) return
    data[p * 4 + 3] = 0
    queue.push(p)
  }
  for (let x = 0; x < width; x += 1) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y)
    push(width - 1, y)
  }
  while (queue.length) {
    const p = queue.pop() as number
    const x = p % width
    const y = Math.floor(p / width)
    push(x - 1, y)
    push(x + 1, y)
    push(x, y - 1)
    push(x, y + 1)
  }
}

// The smallest box holding everything that is not fully transparent.
export function contentBox(data: Uint8ClampedArray, width: number, height: number): Box | null {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) === 0) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return right < 0 ? null : { left, top, right, bottom }
}

// Drops a flat background to transparency and returns the box worth
// keeping. Null means the logo is already as tidy as it can be made.
export function cleanPixels(data: Uint8ClampedArray, width: number, height: number): Box | null {
  if (!hasTransparency(data)) {
    const colour = backgroundColour(data, width, height)
    if (!colour) return null
    clearBackground(data, width, height, colour)
  }
  const box = contentBox(data, width, height)
  if (!box) return null
  const whole = box.left === 0 && box.top === 0 && box.right === width - 1 && box.bottom === height - 1
  return whole ? null : box
}

// The whole job, on a file: tidy the logo where it can be tidied, and hand
// back the original when it cannot (no canvas, a logo that needs nothing,
// or anything at all going wrong).
const MAX_SIDE = 1024

function loadBlob(blob: Blob): Promise<HTMLImageElement> {
  const src = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(src)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(src)
      reject(new Error('could not read that image'))
    }
    img.src = src
  })
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

export async function cleanLogo(blob: Blob): Promise<Blob> {
  try {
    const img = await loadBlob(blob)
    const scale = Math.min(MAX_SIDE / img.naturalWidth, MAX_SIDE / img.naturalHeight, 1)
    const width = Math.max(1, Math.round(img.naturalWidth * scale))
    const height = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.drawImage(img, 0, 0, width, height)
    const picture = ctx.getImageData(0, 0, width, height)
    const box = cleanPixels(picture.data, width, height)
    if (!box) return blob
    const cut = document.createElement('canvas')
    cut.width = box.right - box.left + 1
    cut.height = box.bottom - box.top + 1
    const cutCtx = cut.getContext('2d')
    if (!cutCtx) return blob
    ctx.putImageData(picture, 0, 0)
    cutCtx.drawImage(canvas, box.left, box.top, cut.width, cut.height, 0, 0, cut.width, cut.height)
    return (await toBlob(cut)) ?? blob
  } catch {
    return blob
  }
}
