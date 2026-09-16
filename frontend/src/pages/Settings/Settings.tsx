import { LogOut, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Alert from '../../components/Alert/Alert'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import { useProfile } from '../../context/ProfileContext'
import { api } from '../../lib/api'
import { authClient } from '../../lib/auth-client'
import { draftFromProfile, validate } from '../../profile/draft'
import type { DraftField } from '../../profile/draft'
import { BrandFields, BusinessFields, CustomerFields, ScanNotice, ServicesFields } from '../../profile/ProfileFields'
import { useProfileDraft } from '../../profile/useProfileDraft'
import { useWebsiteScan } from '../../profile/useWebsiteScan'
import styles from './Settings.module.css'

const ALL_FIELDS: DraftField[] = ['businessName', 'description', 'websiteUrl', 'targetAudience', 'localArea', 'services']

// Deleting takes everything with it, so it asks once more first.
function DeleteAccount() {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function remove() {
    setBusy(true)
    setFailed(false)
    try {
      await api('/api/account', { method: 'DELETE' })
      await authClient.signOut()
      navigate('/sign-in', { replace: true })
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <Button
        variant="danger"
        icon={<Trash2 size={18} aria-hidden="true" />}
        onClick={() => setConfirming(true)}
        data-testid="delete-account"
      >
        Delete account
      </Button>
    )
  }
  return (
    <div className={styles.confirm} role="group" aria-label="Confirm delete account">
      <span>
        Delete your account for good? Your business profile, every advert and every image go with
        it. This cannot be undone.
      </span>
      <div className={styles.confirmButtons}>
        <Button variant="danger" loading={busy} onClick={() => void remove()} data-testid="confirm-delete-account">
          Delete everything
        </Button>
        <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      {failed && <Alert tone="error">Your account could not be deleted. Try again.</Alert>}
    </div>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const { profile, setProfile } = useProfile()
  const form = useProfileDraft(draftFromProfile(profile!))
  const { status: scanStatus, scan } = useWebsiteScan()
  const [result, setResult] = useState<'saved' | 'failed' | null>(null)

  // The user asked for it, so what the website shows replaces the current
  // colours and logo; anything not found is left alone.
  async function fetchFromWebsite() {
    const errors = validate(form.draft, ['websiteUrl'])
    if (errors.websiteUrl || !form.draft.websiteUrl.trim()) {
      form.setErrors({ websiteUrl: errors.websiteUrl ?? 'Enter your website first.' })
      return
    }
    const findings = await scan(form.draft.websiteUrl.trim())
    if (!findings) return
    if (findings.colours.length) form.update('brandColours', findings.colours)
    if (findings.logo) form.update('logo', findings.logo)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setResult(null)
    const errors = validate(form.draft, ALL_FIELDS)
    if (Object.keys(errors).length) {
      form.setErrors(errors)
      return
    }
    try {
      setProfile(await form.save())
      setResult('saved')
    } catch {
      setResult('failed')
    }
  }

  async function signOut() {
    await authClient.signOut()
    navigate('/sign-in', { replace: true })
  }

  return (
    <form className={styles.page} onSubmit={(e) => void save(e)} noValidate>
      <div>
        <h1>Settings</h1>
        <p className={styles.lead}>Your business profile. Every advert is written from this.</p>
      </div>
      <Card title="Your business">
        <BusinessFields {...form} />
      </Card>
      <Card title="Your customers">
        <CustomerFields {...form} />
      </Card>
      <Card title="What you sell">
        <ServicesFields {...form} />
      </Card>
      <Card
        title="Your brand"
        actions={
          <Button
            variant="secondary"
            size="sm"
            loading={scanStatus === 'scanning'}
            icon={<RefreshCw size={16} aria-hidden="true" />}
            onClick={() => void fetchFromWebsite()}
            data-testid="fetch-website"
          >
            Fetch from website
          </Button>
        }
      >
        <ScanNotice status={scanStatus} />
        <BrandFields {...form} />
      </Card>
      <div className={styles.saveBar}>
        {result === 'saved' && <Alert tone="success">Profile saved.</Alert>}
        {result === 'failed' && <Alert tone="error">Your profile could not be saved. Check the fields above and try again.</Alert>}
        <Button type="submit" loading={form.saving} data-testid="save-profile">
          Save changes
        </Button>
      </div>
      <Card title="Account">
        <div>
          <Button variant="secondary" icon={<LogOut size={18} aria-hidden="true" />} onClick={() => void signOut()} data-testid="sign-out">
            Sign out
          </Button>
        </div>
        <DeleteAccount />
      </Card>
    </form>
  )
}
