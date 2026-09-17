import { api } from './api'
import type { UploadedPhoto } from './types'

// Mirrors the worker's checks (worker/src/files.ts), so most problems are
// explained before anything is uploaded.
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024
export const MIN_PHOTO_SIDE = 1200
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'
export const PHOTO_RULES = 'JPEG, PNG or WebP, at least 1200 pixels on the shortest side, up to 20 MB.'

export class PhotoError extends Error {}

const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function readImageSize(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new PhotoError('That photo could not be read. Choose another.'))
    }
    img.src = url
  })
}

export async function checkPhoto(
  file: File,
  sizeOf: (file: Blob) => Promise<{ width: number; height: number }> = readImageSize,
): Promise<void> {
  if (!TYPES.has(file.type)) throw new PhotoError('Choose a JPEG, PNG or WebP photo.')
  if (file.size > MAX_PHOTO_BYTES) throw new PhotoError('That photo is over 20 MB. Choose a smaller one.')
  const { width, height } = await sizeOf(file)
  if (Math.min(width, height) < MIN_PHOTO_SIDE) {
    throw new PhotoError(
      `That photo is ${width} × ${height} pixels. Choose one at least ${MIN_PHOTO_SIDE} pixels on the shortest side.`,
    )
  }
}

export async function uploadPhoto(file: File): Promise<UploadedPhoto> {
  await checkPhoto(file)
  return api<UploadedPhoto>('/api/uploads/photo', { blob: file })
}
