import type { ReactNode } from 'react'
import Alert from '../components/Alert/Alert'
import ColourEditor from '../components/ColourEditor/ColourEditor'
import { TextArea, TextInput } from '../components/Field/Field'
import LogoEditor from '../components/LogoEditor/LogoEditor'
import ServicesEditor from '../components/ServicesEditor/ServicesEditor'
import ToneScale from '../components/ToneScale/ToneScale'
import { MAX_COLOURS, MAX_SERVICES, TONES } from './draft'
import type { DraftErrors, DraftField, ProfileDraft } from './draft'
import styles from './ProfileFields.module.css'
import type { ScanStatus } from './useWebsiteScan'

// The business profile's fields, grouped the way onboarding asks for them.
// Settings shows the same groups all at once.

export interface FieldsProps {
  draft: ProfileDraft
  update: <K extends DraftField>(field: K, value: ProfileDraft[K]) => void
  errors: DraftErrors
  // Fields just filled in from the website, pointed out until saved.
  changed?: ReadonlySet<DraftField>
}

// Marks a field the website fill has just changed.
function Changed({ field, changed, children }: { field: DraftField; changed?: ReadonlySet<DraftField>; children: ReactNode }) {
  if (!changed?.has(field)) return <>{children}</>
  return (
    <div className={styles.changed} data-testid={`changed-${field}`}>
      <span className={styles.changedTag}>Updated from your website</span>
      {children}
    </div>
  )
}

export function WebsiteField({ draft, update, errors }: FieldsProps) {
  return (
    <TextInput
      label="Website"
      hint="We read it to fill in your details, colours and logo."
      value={draft.websiteUrl}
      inputMode="url"
      placeholder="yourbusiness.co.uk"
      maxLength={300}
      onChange={(e) => update('websiteUrl', e.target.value)}
      error={errors.websiteUrl}
      data-testid="website"
    />
  )
}

export function BusinessFields({ draft, update, errors, changed }: FieldsProps) {
  return (
    <>
      <Changed field="businessName" changed={changed}>
        <TextInput
          label="Business name"
          value={draft.businessName}
          maxLength={100}
          autoComplete="organization"
          onChange={(e) => update('businessName', e.target.value)}
          error={errors.businessName}
          data-testid="business-name"
        />
      </Changed>
      <Changed field="description" changed={changed}>
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
      </Changed>
    </>
  )
}

export function CustomerFields({ draft, update, errors, changed }: FieldsProps) {
  return (
    <>
      <Changed field="targetAudience" changed={changed}>
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
      </Changed>
      <Changed field="localArea" changed={changed}>
        <TextInput
          label="Local area"
          hint="Where your customers are (e.g. Kingston, London or UK)."
          value={draft.localArea}
          maxLength={200}
          onChange={(e) => update('localArea', e.target.value)}
          error={errors.localArea}
          data-testid="local-area"
        />
      </Changed>
      <Changed field="tone" changed={changed}>
        <ToneScale value={draft.tone} onChange={(tone) => update('tone', tone)} options={TONES} />
      </Changed>
    </>
  )
}

export function ServicesFields({ draft, update, errors, changed }: FieldsProps) {
  return (
    <Changed field="services" changed={changed}>
      <ServicesEditor
        services={draft.services}
        onChange={(services) => update('services', services)}
        max={MAX_SERVICES}
        error={errors.services}
      />
    </Changed>
  )
}

const SCAN_NOTICES: Partial<Record<ScanStatus, { tone: 'info' | 'success' | 'warning'; text: string }>> = {
  scanning: { tone: 'info', text: 'Reading your website for your details, colours and logo. This can take up to 30 seconds.' },
  found: { tone: 'success', text: 'We filled in what we could from your website. Check each part and change anything that is not right.' },
  nothing: { tone: 'warning', text: 'We could not find your details on your website. Fill them in yourself.' },
  failed: { tone: 'warning', text: 'We could not read your website. Fill in your details yourself.' },
  limited: { tone: 'warning', text: 'That is a lot of website checks in one go. Wait a minute and try again.' },
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

export function BrandFields({ draft, update, errors, changed }: FieldsProps) {
  return (
    <>
      <Changed field="brandColours" changed={changed}>
        <ColourEditor colours={draft.brandColours} onChange={(c) => update('brandColours', c)} max={MAX_COLOURS} />
      </Changed>
      <Changed field="logo" changed={changed}>
        <LogoEditor logo={draft.logo} onChange={(logo) => update('logo', logo)} />
      </Changed>
      {errors.logo && <Alert tone="error">That logo could not be saved. Upload it again.</Alert>}
    </>
  )
}
