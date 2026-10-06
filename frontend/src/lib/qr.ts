// Big enough to print on a card without going fuzzy.
const SIZE = 640
const MARGIN = 2

// Drawn in the browser, so no QR image is ever stored or fetched.
export async function drawQrCode(canvas: HTMLCanvasElement, url: string): Promise<void> {
  // Loaded only on the page that draws one, so it stays out of the bundle
  // everyone else downloads.
  const { default: QRCode } = await import('qrcode')
  await QRCode.toCanvas(canvas, url, { width: SIZE, margin: MARGIN, color: { dark: '#0f172a', light: '#ffffff' } })
}

export function saveQrCode(canvas: HTMLCanvasElement | null, filename: string): void {
  if (!canvas) return
  const link = document.createElement('a')
  link.href = canvas.toDataURL('image/png')
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
}
