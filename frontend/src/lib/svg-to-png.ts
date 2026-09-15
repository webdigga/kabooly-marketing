// Logos must be raster for image generation, but many sites (and people)
// have SVG logos. The browser can draw an SVG onto a canvas, so conversion
// happens here rather than on the Worker.

export const LOGO_MAX_EDGE = 1024

export function svgSize(svg: Element, maxEdge = LOGO_MAX_EDGE): { width: number; height: number } {
  const [, , boxWidth = 0, boxHeight = 0] = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  let width = parseFloat(svg.getAttribute('width') ?? '')
  let height = parseFloat(svg.getAttribute('height') ?? '')
  // Percentages and missing sizes are not usable; the viewBox then decides.
  if (!(width > 0 && height > 0) || /%/.test(svg.getAttribute('width') ?? '')) {
    width = boxWidth
    height = boxHeight
  }
  if (!(width > 0 && height > 0)) {
    width = maxEdge
    height = maxEdge
  }
  const scale = maxEdge / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export async function svgToPng(svgText: string): Promise<Blob> {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const svg = doc.documentElement
  if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('Not an SVG')
  const { width, height } = svgSize(svg)
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }),
  )
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')?.drawImage(img, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not convert logo'))), 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
