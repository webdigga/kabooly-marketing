import type { DraftField, ProfileDraft } from './draft'
import { MAX_COLOURS, MAX_SERVICES } from './draft'
import type { ScanFindings } from './useWebsiteScan'
import type { BusinessDetails } from '../lib/types'

export const FIELD_NAMES: Record<DraftField, string> = {
  businessName: 'business name',
  description: 'what your business does',
  websiteUrl: 'website',
  targetAudience: 'customers',
  localArea: 'local area',
  tone: 'tone of voice',
  services: 'services',
  brandColours: 'colours',
  logo: 'logo',
}

function same(a: ProfileDraft[DraftField], b: ProfileDraft[DraftField]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// The fields Haiku read off the website's words.
function fromWords(details: BusinessDetails | null): Partial<ProfileDraft> {
  if (!details) return {}
  const { businessName, description, targetAudience, localArea, tone, services } = details
  return {
    ...(businessName && { businessName }),
    ...(description && { description }),
    ...(targetAudience && { targetAudience }),
    ...(localArea && { localArea }),
    ...(tone && { tone }),
    ...(services.length && { services: services.slice(0, MAX_SERVICES) }),
  }
}

// The fields read off the website's own styling.
function fromBrand(findings: ScanFindings): Partial<ProfileDraft> {
  return {
    ...(findings.colours.length && { brandColours: findings.colours.slice(0, MAX_COLOURS) }),
    ...(findings.logo && { logo: findings.logo }),
  }
}

// Puts what a website scan found into the draft. Anything the website did
// not tell us keeps its current value. Returns the fields whose value
// changed, so the form can point them out.
export function applyFindings(draft: ProfileDraft, findings: ScanFindings): { draft: ProfileDraft; changed: DraftField[] } {
  const found: Partial<ProfileDraft> = { ...fromWords(findings.details), ...fromBrand(findings) }
  const next = { ...draft, ...found }
  const changed = (Object.keys(found) as DraftField[]).filter((field) => !same(draft[field], next[field]))
  return { draft: next, changed }
}

export function changedSummary(changed: DraftField[]): string {
  const names = changed.map((f) => FIELD_NAMES[f])
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join('')
  return `Updated from your website: ${list}. Check them, then save.`
}
