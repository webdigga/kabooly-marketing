import type { ReactNode } from 'react'
import Alert from '../components/Alert/Alert'
import ColourEditor from '../components/ColourEditor/ColourEditor'
import { TextArea, TextInput } from '../components/Field/Field'
import LogoEditor from '../components/LogoEditor/LogoEditor'
import ServicesEditor from '../components/ServicesEditor/ServicesEditor'
import ToneScale from '../components/ToneScale/ToneScale'
import { MAX_COLOURS, MAX_SERVICES, TONES } from './draft'
import type { DraftErrors, DraftField, ProfileDraft } from './draft'
import type { ScanStatus } from './useWebsiteScan'

// The business profile's fields, grouped the way onboarding asks for them.
// Settings shows the same groups all at once.

export interface FieldsProps {
  draft: ProfileDraft
  update: <K extends DraftField>(field: K, value: ProfileDraft[K]) => void
  errors: DraftErrors
}

export function BusinessFields({ draft, update, errors, websiteAction }: FieldsProps & { websiteAction?: ReactNode }) {
  return (
    <>
      <TextInput
        label="Business name"
        value={draft.businessName}
        maxLength={100}
        autoComplete="organization"
        onChange={(e) => update('businessName', e.target.value)}
        error={errors.businessName}
        data-testid="business-name"
      />
      <TextArea
        label="What your business does"
        hint="A sentence or two, in your own words."
        value={draft.description}
        maxLength={1000}
        rows={3}
        onChange={(e) => update('description', e.target.value)}
        error={errors.description}
        data-testid="description"
      />
      <TextInput
        label="Website"
        optional
        hint="We will look at it for your brand colours and logo."
        value={draft.websiteUrl}
        inputMode="url"
        placeholder="yourbusiness.co.uk"
        maxLength={300}
        onChange={(e) => update('websiteUrl', e.target.value)}
        error={errors.websiteUrl}
        data-testid="website"
      />
      {websiteAction}
    </>
  )
}

export function CustomerFields({ draft, update, errors }: FieldsProps) {
  return (
    <>
      <TextArea
        label="Who your customers are"
        hint="For example: busy families, landlords, dog owners."
        value={draft.targetAudience}
        maxLength={500}
        rows={2}
        onChange={(e) => update('targetAudience', e.target.value)}
        error={errors.targetAudience}
        data-testid="audience"
      />
      <TextInput
        label="Local area"
        hint="Where your customers are (e.g. Kingston, London or UK)."
        value={draft.localArea}
        maxLength={200}
        onChange={(e) => update('localArea', e.target.value)}
        error={errors.localArea}
        data-testid="local-area"
      />
      <ToneScale value={draft.tone} onChange={(tone) => update('tone', tone)} options={TONES} />
    </>
  )
}

export function ServicesFields({ draft, update, errors }: FieldsProps) {
  return (
    <ServicesEditor
      services={draft.services}
      onChange={(services) => update('services', services)}
      max={MAX_SERVICES}
      error={errors.services}
    />
  )
}

const SCAN_NOTICES: Partial<Record<ScanStatus, { tone: 'info' | 'success' | 'warning'; text: string }>> = {
  scanning: { tone: 'info', text: 'Looking at your website for your colours and logo.' },
  found: { tone: 'success', text: 'We filled these in from your website. Change anything that is not right.' },
  nothing: { tone: 'warning', text: 'We could not find colours or a logo on your website. Add them below.' },
  failed: { tone: 'warning', text: 'We could not read your website. Add your colours and logo below.' },
}

export function ScanNotice({ status }: { status: ScanStatus }) {
  const notice = SCAN_NOTICES[status]
  if (!notice) return null
  return (
    <Alert tone={notice.tone} testId="scan-notice">
      {notice.text}
    </Alert>
  )
}

export function BrandFields({ draft, update, errors }: FieldsProps) {
  return (
    <>
      <ColourEditor colours={draft.brandColours} onChange={(c) => update('brandColours', c)} max={MAX_COLOURS} />
      <LogoEditor logo={draft.logo} onChange={(logo) => update('logo', logo)} />
      {errors.logo && <Alert tone="error">That logo could not be saved. Upload it again.</Alert>}
    </>
  )
}
