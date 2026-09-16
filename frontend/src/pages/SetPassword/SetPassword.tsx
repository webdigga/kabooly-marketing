import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Alert from '../../components/Alert/Alert'
import AuthLayout from '../../components/AuthLayout/AuthLayout'
import authStyles from '../../components/AuthLayout/AuthLayout.module.css'
import Button from '../../components/Button/Button'
import { TextInput } from '../../components/Field/Field'
import { MIN_PASSWORD_LENGTH, setPassword } from '../../lib/email-otp'

// Reached from the email sent when checkout creates the account.
export default function SetPassword() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPasswordValue] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await setPassword(token, password)
      navigate('/sign-in', { replace: true, state: { notice: 'Password saved. Sign in to get started.' } })
    } catch {
      setError('This link has expired or has already been used. Use "Forgot your password?" to get a new code.')
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Choose your password"
      subtitle="Your Kabooly Marketing account is ready. Choose a password to sign in."
      footer={<Link to="/forgot-password">Forgot your password?</Link>}
    >
      {!token && <Alert tone="error">This link is incomplete. Open it again from your email.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <form onSubmit={(e) => void submit(e)} className={authStyles.form}>
        <TextInput
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          required
          value={password}
          onChange={(e) => setPasswordValue(e.target.value)}
          data-testid="password-input"
        />
        <TextInput
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          data-testid="confirm-input"
        />
        <Button type="submit" block loading={busy} disabled={!token} data-testid="set-password">
          Save password
        </Button>
      </form>
    </AuthLayout>
  )
}
