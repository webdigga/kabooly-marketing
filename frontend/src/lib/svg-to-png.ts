// Logos must be raster for image generation, but many sites (and people)
// have SVG logos. The browser can draw an SVG onto a canvas, so conversion
// happens here rather than on the Worker.

export const LOGO_MAX_EDGE = 1024

interface Size {
  width: number
  height: number
}

function usable(size: Size): boolean {
  return size.width > 0 && size.height > 0
}

// The width and height attributes, unless they are percentages, which say
// nothing about the real shape.
function attributeSize(svg: Element): Size {
  const width = svg.getAttribute('width') ?? ''
  if (/%/.test(width)) return { width: 0, height: 0 }
  return { width: parseFloat(width), height: parseFloat(svg.getAttribute('height') ?? '') }
}

function viewBoxSize(svg: Element): Size {
  const [, , width = 0, height = 0] = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  return { width, height }
}

// The attributes first, then the viewBox, then a square: an SVG that says
// nothing about its size still has to be drawn at some size.
export function svgSize(svg: Element, maxEdge = LOGO_MAX_EDGE): Size {
  const square = { width: maxEdge, height: maxEdge }
  const found = [attributeSize(svg), viewBoxSize(svg), square].find(usable) ?? square
  const scale = maxEdge / Math.max(found.width, found.height)
  return { width: Math.round(found.width * scale), height: Math.round(found.height * scale) }
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
