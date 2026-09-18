import type { Profile } from '../lib/types'

export const MAX_SERVICES = 20
export const MAX_COLOURS = 5

export interface ProfileDraft {
  businessName: string
  description: string
  websiteUrl: string
  targetAudience: string
  localArea: string
  tone: number
  services: string[]
  brandColours: string[]
  logo: { key: string; url: string } | null
}

export type DraftField = keyof ProfileDraft
export type DraftErrors = Partial<Record<DraftField, string>>

export const EMPTY_DRAFT: ProfileDraft = {
  businessName: '',
  description: '',
  websiteUrl: '',
  targetAudience: '',
  localArea: '',
  tone: 3,
  services: [],
  brandColours: [],
  logo: null,
}

export function draftFromProfile(profile: Profile): ProfileDraft {
  return {
    businessName: profile.businessName,
    description: profile.description,
    websiteUrl: profile.websiteUrl ?? '',
    targetAudience: profile.targetAudience,
    localArea: profile.localArea,
    tone: profile.tone,
    services: profile.services,
    brandColours: profile.brandColours,
    logo: profile.logoKey && profile.logoUrl ? { key: profile.logoKey, url: profile.logoUrl } : null,
  }
}

export function draftToBody(draft: ProfileDraft, brandStripKey: string | null = null) {
  return {
    businessName: draft.businessName.trim(),
    description: draft.description.trim(),
    websiteUrl: draft.websiteUrl.trim() || null,
    targetAudience: draft.targetAudience.trim(),
    localArea: draft.localArea.trim(),
    tone: draft.tone,
    services: draft.services,
    brandColours: draft.brandColours,
    logoKey: draft.logo?.key ?? null,
    brandStripKey,
  }
}

const WEBSITE = /^(https?:\/\/)?[^\s/.]+(\.[^\s/.]+)+(\/\S*)?$/i

const CHECKS: Partial<Record<DraftField, (d: ProfileDraft) => string | null>> = {
  businessName: (d) => (d.businessName.trim() ? null : 'Enter your business name.'),
  description: (d) => (d.description.trim() ? null : 'Say what your business does.'),
  websiteUrl: (d) =>
    !d.websiteUrl.trim() || WEBSITE.test(d.websiteUrl.trim()) ? null : 'Enter a website address like acme.co.uk.',
  targetAudience: (d) => (d.targetAudience.trim() ? null : 'Say who your customers are.'),
  localArea: (d) => (d.localArea.trim() ? null : 'Enter the area you cover.'),
  services: (d) => (d.services.length ? null : 'Add at least one service or product.'),
}

export function validate(draft: ProfileDraft, fields: DraftField[]): DraftErrors {
  const errors: DraftErrors = {}
  for (const field of fields) {
    const message = CHECKS[field]?.(draft)
    if (message) errors[field] = message
  }
  return errors
}

// Server field names ("brandColours.0") mapped back to draft fields.
export function fieldFromServer(field: string | undefined): DraftField | null {
  const base = (field ?? '').split('.')[0]
  if (base === 'logoKey') return 'logo'
  return base && base in EMPTY_DRAFT ? (base as DraftField) : null
}

export const TONES = [
  { value: 1, label: 'Formal' },
  { value: 2, label: 'Professional' },
  { value: 3, label: 'Friendly' },
  { value: 4, label: 'Casual' },
  { value: 5, label: 'Playful' },
]
