import { api } from './api'
import { cleanLogo } from './logo-clean'
import { svgToPng } from './svg-to-png'

export const MAX_LOGO_BYTES = 2 * 1024 * 1024
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/avif,image/svg+xml'

export interface UploadedLogo {
  key: string
  url: string
}

export class LogoError extends Error {}

// AVIF is here because sites serve logos in it; the browser decodes it and
// the Worker converts anything it cannot read itself.
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif'])

async function asRaster(file: Blob): Promise<Blob> {
  if (file.type === 'image/svg+xml') return svgToPng(await file.text())
  if (!RASTER_TYPES.has(file.type)) throw new LogoError('Choose a PNG, JPEG, WebP, AVIF or SVG image.')
  return file
}

export async function uploadLogoFile(file: Blob): Promise<UploadedLogo> {
  // Every logo is tidied on the way in (flat background dropped, empty
  // margins cut) so one stored file suits every advert.
  const raster = await cleanLogo(await asRaster(file))
  if (raster.size > MAX_LOGO_BYTES) throw new LogoError('That image is over 2 MB. Choose a smaller one.')
  return api<UploadedLogo>('/api/uploads/logo', { blob: raster })
}

// A logo the website scan stored: read back, tidied and saved again. The
// scan's own file is left behind and cleared when the profile is saved.
export async function refineLogo(logo: UploadedLogo): Promise<UploadedLogo> {
  try {
    const res = await fetch(logo.url)
    if (!res.ok) return logo
    return await uploadLogoFile(await res.blob())
  } catch {
    return logo
  }
}

export async function uploadLogoSvg(svg: string): Promise<UploadedLogo> {
  return uploadLogoFile(new Blob([svg], { type: 'image/svg+xml' }))
}
