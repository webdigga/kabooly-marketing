// Shapes the worker sends back. Kept in step with worker/src by hand; the
// worker tests pin the JSON these mirror.

export type Platform = 'instagram' | 'facebook' | 'nextdoor'

export interface Profile {
  businessName: string
  description: string
  websiteUrl: string | null
  targetAudience: string
  localArea: string
  tone: number
  services: string[]
  brandColours: string[]
  logoKey: string | null
  logoUrl: string | null
}

export interface StoredFile {
  url: string
  downloadUrl: string
}

export interface AdvertImage extends StoredFile {
  platform: Platform
  label: string
  width: number
  height: number
}

export type AdvertFormat = 'images' | 'photo' | 'carousel'

export interface Slide {
  heading: string
  body: string
}

export type VideoStatus = 'pending' | 'ready' | 'failed'

export interface AdvertVideo {
  status: VideoStatus
  motion: string | null
  start: StoredFile
  video: StoredFile | null
}

export interface Advert {
  id: string
  format: AdvertFormat
  topic: string
  body: string
  createdAt: string
  updatedAt: string
  images: AdvertImage[]
  slides: Slide[] | null
  background: StoredFile | null
  video: AdvertVideo | null
}

export interface Allowance {
  used: number
  limit: number
  nextFreeAt: string | null
}

export interface Usage {
  imagesToday: Allowance
  imagesThisMonth: Allowance
  videosThisMonth: Allowance
}

export type GenerationEvent =
  | { type: 'advert'; advert: Advert }
  | { type: 'image'; advertId: string; image: AdvertImage }
  | { type: 'image_error'; advertId: string; platform: Platform; error: string }
  | { type: 'background'; advertId: string; background: StoredFile }
  | { type: 'background_error'; advertId: string; error: string }
  | { type: 'error'; error: string }
  | { type: 'done'; usage: Usage }

export interface BusinessDetails {
  businessName: string | null
  description: string | null
  services: string[]
  targetAudience: string | null
  localArea: string | null
  tone: number | null
}

export interface ScanResult {
  websiteUrl: string
  reachable: boolean
  colours: string[]
  logo: { key: string; url: string } | null
  logoSvg: string | null
  details: BusinessDetails | null
}

export interface UploadedPhoto {
  key: string
  url: string
  width: number
  height: number
}
