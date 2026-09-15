import { api } from './api'
import { svgToPng } from './svg-to-png'

export const MAX_LOGO_BYTES = 2 * 1024 * 1024
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml'

export interface UploadedLogo {
  key: string
  url: string
}

export class LogoError extends Error {}

const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

async function asRaster(file: Blob): Promise<Blob> {
  if (file.type === 'image/svg+xml') return svgToPng(await file.text())
  if (!RASTER_TYPES.has(file.type)) throw new LogoError('Choose a PNG, JPEG, WebP or SVG image.')
  return file
}

export async function uploadLogoFile(file: Blob): Promise<UploadedLogo> {
  const raster = await asRaster(file)
  if (raster.size > MAX_LOGO_BYTES) throw new LogoError('That image is over 2 MB. Choose a smaller one.')
  return api<UploadedLogo>('/api/uploads/logo', { blob: raster })
}

export async function uploadLogoSvg(svg: string): Promise<UploadedLogo> {
  return uploadLogoFile(new Blob([svg], { type: 'image/svg+xml' }))
}
