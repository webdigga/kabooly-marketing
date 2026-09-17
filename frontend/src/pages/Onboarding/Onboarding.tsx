import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import Alert from '../../components/Alert/Alert'
import Button from '../../components/Button/Button'
import Logo from '../../components/Logo/Logo'
import { useProfile } from '../../context/ProfileContext'
import { authClient } from '../../lib/auth-client'
import { ApiError } from '../../lib/api'
import { EMPTY_DRAFT, fieldFromServer, validate } from '../../profile/draft'
import type { DraftField } from '../../profile/draft'
import { BrandFields, BusinessFields, CustomerFields, ScanNotice, ServicesFields, WebsiteField } from '../../profile/ProfileFields'
import type { FieldsProps } from '../../profile/ProfileFields'
import { useProfileDraft } from '../../profile/useProfileDraft'
import { useWebsiteScan } from '../../profile/useWebsiteScan'
import { applyFindings } from '../../profile/website-fill'
import styles from './Onboarding.module.css'

interface Step {
  title: string
  intro: string
  fields: DraftField[]
  render: (props: FieldsProps) => ReactNode
}

const STEPS: Step[] = [
  {
    title: 'Your website',
    intro: 'We read your website and fill in as much of your profile as we can. You can check and change everything.',
    fields: ['websiteUrl'],
    render: (props) => <WebsiteField {...props} />,
  },
  {
    title: 'Your business',
    intro: 'Tell us who you are. This shapes every advert we write for you.',
    fields: ['businessName', 'description'],
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
    intro: 'Your colours and logo go into your adverts. You can change these later in Settings.',
    fields: [],
    render: (props) => <BrandFields {...props} />,
  },
]

export default function Onboarding() {
  const navigate = useNavigate()
  const { profile, setProfile } = useProfile()
  const form = useProfileDraft(EMPTY_DRAFT)
  const { status: scanStatus, scan } = useWebsiteScan()
  const [step, setStep] = useState(0)
  const [changed, setChanged] = useState<ReadonlySet<DraftField>>(new Set())
  const [saveError, setSaveError] = useState<string | null>(null)

  if (profile) return <Navigate to="/" replace />
  const current = STEPS[step]!
  const last = step === STEPS.length - 1
  const scanning = scanStatus === 'scanning'

  function goTo(index: number) {
    setStep(index)
    window.scrollTo(0, 0)
  }

  // Step one: read the website, fill in what it tells us, and move on
  // whatever happens.
  async function fillFromWebsite() {
    const url = form.draft.websiteUrl.trim()
    if (!url) {
      form.setErrors({ websiteUrl: 'Enter your website, or choose "I do not have a website".' })
      return
    }
    const findings = await scan(url)
    if (findings) {
      const filled = applyFindings(form.draft, findings)
      form.setDraft(filled.draft)
      setChanged(new Set(filled.changed))
    }
    goTo(1)
  }

  function skipWebsite() {
    form.update('websiteUrl', '')
    goTo(1)
  }

  async function next(event: FormEvent) {
    event.preventDefault()
    const errors = validate(form.draft, current.fields)
    if (Object.keys(errors).length) {
      form.setErrors(errors)
      return
    }
    if (step === 0) {
      await fillFromWebsite()
      return
    }
    if (!last) {
      goTo(step + 1)
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
        {(step === 1 || scanning) && <ScanNotice status={scanStatus} />}
        <div className={styles.fields}>{current.render({ ...form, changed })}</div>
        <div className={styles.buttons}>
          {step > 0 && (
            <Button variant="secondary" onClick={() => goTo(step - 1)} data-testid="back-step">
              Back
            </Button>
          )}
          <Button type="submit" loading={form.saving || scanning} data-testid="next-step">
            {step === 0 ? 'Fill in from my website' : last ? 'Finish' : 'Next'}
          </Button>
        </div>
        {step === 0 && (
          <Button variant="ghost" size="sm" onClick={skipWebsite} disabled={scanning} data-testid="skip-website">
            I do not have a website
          </Button>
        )}
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
