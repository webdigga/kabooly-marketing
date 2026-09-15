import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Alert from '../../components/Alert/Alert'
import AuthLayout from '../../components/AuthLayout/AuthLayout'
import authStyles from '../../components/AuthLayout/AuthLayout.module.css'
import Button from '../../components/Button/Button'
import { TextInput } from '../../components/Field/Field'
import { MIN_PASSWORD_LENGTH, requestPasswordReset, resetPassword } from '../../lib/email-otp'

export default function ForgotPassword() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'email' | 'reset'>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function requestCode(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await requestPasswordReset(email)
      setStep('reset')
    } catch {
      setError('Could not send the code. Check the email address and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function reset(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await resetPassword(email, otp, password)
      navigate('/sign-in', { replace: true, state: { notice: 'Password changed. Sign in with your new password.' } })
    } catch {
      setError('That code did not work. Check it and try again.')
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle={
        step === 'email'
          ? 'Enter your email and we will send you a 6-digit code.'
          : `If ${email.trim()} has an account, a code is on its way. Enter it with a new password.`
      }
      footer={<Link to="/sign-in">Back to sign in</Link>}
    >
      {error && <Alert tone="error">{error}</Alert>}
      {step === 'email' ? (
        <form onSubmit={(e) => void requestCode(e)} className={authStyles.form}>
          <TextInput
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="email-input"
          />
          <Button type="submit" block loading={busy} data-testid="send-code">
            Send code
          </Button>
        </form>
      ) : (
        <form onSubmit={(e) => void reset(e)} className={authStyles.form}>
          <TextInput
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            data-testid="otp-input"
          />
          <TextInput
            label="New password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="password-input"
          />
          <Button type="submit" block loading={busy} data-testid="reset-password">
            Change password
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
