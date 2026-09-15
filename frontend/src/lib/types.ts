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

export interface AdvertImage {
  platform: Platform
  label: string
  width: number
  height: number
  url: string
  downloadUrl: string
}

export interface Advert {
  id: string
  topic: string
  body: string
  createdAt: string
  updatedAt: string
  images: AdvertImage[]
}

export interface Usage {
  imagesUsed: number
  imagesLimit: number
  nextFreeAt: string | null
}

export type GenerationEvent =
  | { type: 'advert'; advert: Advert }
  | { type: 'image'; advertId: string; image: AdvertImage }
  | { type: 'image_error'; advertId: string; platform: Platform; error: string }
  | { type: 'error'; error: string }
  | { type: 'done'; usage: Usage }

export interface ScanResult {
  websiteUrl: string
  reachable: boolean
  colours: string[]
  logo: { key: string; url: string } | null
  logoSvg: string | null
}
