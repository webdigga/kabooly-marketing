import { useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import Alert from '../../components/Alert/Alert'
import Button from '../../components/Button/Button'
import Logo from '../../components/Logo/Logo'
import { useProfile } from '../../context/ProfileContext'
import { authClient } from '../../lib/auth-client'
import { ApiError } from '../../lib/api'
import { EMPTY_DRAFT, fieldFromServer, validate } from '../../profile/draft'
import type { DraftField, ProfileDraft } from '../../profile/draft'
import { BrandFields, BusinessFields, CustomerFields, ScanNotice, ServicesFields } from '../../profile/ProfileFields'
import type { FieldsProps } from '../../profile/ProfileFields'
import { useProfileDraft } from '../../profile/useProfileDraft'
import { useWebsiteScan } from '../../profile/useWebsiteScan'
import type { ScanStatus } from '../../profile/useWebsiteScan'
import styles from './Onboarding.module.css'

interface Step {
  title: string
  intro: string
  fields: DraftField[]
  render: (props: FieldsProps, scan: ScanStatus) => ReactNode
}

const STEPS: Step[] = [
  {
    title: 'Your business',
    intro: 'Tell us who you are. This shapes every advert we write for you.',
    fields: ['businessName', 'description', 'websiteUrl'],
    render: (props) => <BusinessFields {...props} />,
  },
  {
    title: 'Your customers',
    intro: 'Who you want to reach, where, and how you like to sound.',
    fields: ['targetAudience', 'localArea'],
    render: (props) => <CustomerFields {...props} />,
  },
  {
    title: 'What you sell',
    intro: 'Your services or products. We suggest advert topics from these.',
    fields: ['services'],
    render: (props) => <ServicesFields {...props} />,
  },
  {
    title: 'Your brand',
    intro: 'Your colours and logo go into your advert images. You can change these later in Settings.',
    fields: [],
    render: (props, scan) => (
      <>
        <ScanNotice status={scan} />
        <BrandFields {...props} />
      </>
    ),
  },
]

// Pre-fills what the scan found, without overwriting anything the user has
// already chosen themselves.
function mergeFindings(draft: ProfileDraft, findings: { colours: string[]; logo: ProfileDraft['logo'] }): ProfileDraft {
  return {
    ...draft,
    brandColours: draft.brandColours.length ? draft.brandColours : findings.colours,
    logo: draft.logo ?? findings.logo,
  }
}

export default function Onboarding() {
  const navigate = useNavigate()
  const { profile, setProfile } = useProfile()
  const form = useProfileDraft(EMPTY_DRAFT)
  const { status: scanStatus, scan } = useWebsiteScan()
  const [step, setStep] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const scannedUrl = useRef('')

  if (profile) return <Navigate to="/" replace />
  const current = STEPS[step]!
  const last = step === STEPS.length - 1

  function startScan() {
    const url = form.draft.websiteUrl.trim()
    if (!url || url === scannedUrl.current) return
    scannedUrl.current = url
    void scan(url).then((findings) => {
      if (findings) form.setDraft((d) => mergeFindings(d, findings))
    })
  }

  async function next(event: FormEvent) {
    event.preventDefault()
    const errors = validate(form.draft, current.fields)
    if (Object.keys(errors).length) {
      form.setErrors(errors)
      return
    }
    if (step === 0) startScan()
    if (!last) {
      setStep(step + 1)
      window.scrollTo(0, 0)
      return
    }
    setSaveError(null)
    try {
      setProfile(await form.save())
      navigate('/', { replace: true })
    } catch (err) {
      // Go back to the step holding the field the server rejected.
      const field = err instanceof ApiError ? fieldFromServer(err.body.field) : null
      const index = STEPS.findIndex((s) => field && s.fields.includes(field))
      if (index >= 0) setStep(index)
      setSaveError('Your profile could not be saved. Check the highlighted field and try again.')
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.brand}>
        <Logo size={28} />
        <span>Set up your business</span>
      </div>
      <form className={styles.card} onSubmit={(e) => void next(e)} noValidate>
        <p className={styles.progress} aria-live="polite">
          Step {step + 1} of {STEPS.length}
        </p>
        <div className={styles.bar} aria-hidden="true">
          <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
        <h1 className={styles.title}>{current.title}</h1>
        <p className={styles.intro}>{current.intro}</p>
        {saveError && <Alert tone="error">{saveError}</Alert>}
        <div className={styles.fields}>{current.render(form, scanStatus)}</div>
        <div className={styles.buttons}>
          {step > 0 && (
            <Button variant="secondary" onClick={() => setStep(step - 1)} data-testid="back-step">
              Back
            </Button>
          )}
          <Button type="submit" loading={form.saving} data-testid="next-step">
            {last ? 'Finish' : 'Next'}
          </Button>
        </div>
      </form>
      <Button
        variant="ghost"
        size="sm"
        className={styles.signOut}
        onClick={() => void authClient.signOut().then(() => navigate('/sign-in', { replace: true }))}
        data-testid="onboarding-sign-out"
      >
        Sign out
      </Button>
    </main>
  )
}
