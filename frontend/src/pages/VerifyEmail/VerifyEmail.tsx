import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import Alert from '../../components/Alert/Alert'
import AuthLayout from '../../components/AuthLayout/AuthLayout'
import authStyles from '../../components/AuthLayout/AuthLayout.module.css'
import Button from '../../components/Button/Button'
import { TextInput } from '../../components/Field/Field'
import PageLoader from '../../components/PageLoader/PageLoader'
import { authClient } from '../../lib/auth-client'
import { sendVerificationCode, verifyEmail } from '../../lib/email-otp'

// Reached with a live but unverified session (after sign-up or sign-in).
// The session stays signed in throughout; only the app is gated.
export default function VerifyEmail() {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: session, isPending, refetch } = authClient.useSession()
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const justSent = Boolean((location.state as { sent?: boolean } | null)?.sent)

  if (isPending) return <PageLoader />
  if (!session) return <Navigate to="/sign-in" replace />
  if (session.user.emailVerified) return <Navigate to="/" replace />
  const email = session.user.email

  async function verify(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await verifyEmail(email, otp)
      await refetch()
      navigate('/', { replace: true })
    } catch {
      setError('That code did not work. Check it and try again.')
      setBusy(false)
    }
  }

  async function resend() {
    setError(null)
    setNotice(null)
    try {
      await sendVerificationCode(email)
      setNotice(`We sent a new code to ${email}.`)
    } catch {
      setError('Could not send the code. Try again.')
    }
  }

  async function switchAccount() {
    await authClient.signOut()
    navigate('/sign-in', { replace: true })
  }

  return (
    <AuthLayout
      title="Check your email"
      subtitle={
        justSent
          ? `We sent a 6-digit code to ${email}. Enter it to verify your email.`
          : `Enter the 6-digit code we emailed to ${email}.`
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => void resend()} data-testid="resend-code">
            Send a new code
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void switchAccount()} data-testid="cancel-verify">
            Use a different account
          </Button>
        </>
      }
    >
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <form onSubmit={(e) => void verify(e)} className={authStyles.form}>
        <TextInput
          label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
          data-testid="otp-input"
        />
        <Button type="submit" block loading={busy} disabled={otp.length !== 6} data-testid="verify-button">
          Verify email
        </Button>
      </form>
    </AuthLayout>
  )
}
