import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import Alert from '../../components/Alert/Alert'
import AuthLayout from '../../components/AuthLayout/AuthLayout'
import authStyles from '../../components/AuthLayout/AuthLayout.module.css'
import Button from '../../components/Button/Button'
import Divider from '../../components/Divider/Divider'
import { TextInput } from '../../components/Field/Field'
import GoogleButton from '../../components/GoogleButton/GoogleButton'
import { authClient } from '../../lib/auth-client'
import { authErrorMessage, oauthErrorMessage } from '../../lib/auth-errors'
import { MIN_PASSWORD_LENGTH, sendVerificationCode } from '../../lib/email-otp'

type Mode = 'sign-in' | 'sign-up'

const COPY = {
  'sign-in': {
    title: 'Sign in',
    subtitle: 'Create local adverts for Instagram, Facebook and Nextdoor.',
    button: 'Sign in',
    autoComplete: 'current-password',
  },
  'sign-up': {
    title: 'Create your account',
    subtitle: 'Just an email and a password to start. You will tell us about your business next.',
    button: 'Create account',
    autoComplete: 'new-password',
  },
}

function useCredentials(mode: Mode) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(() => oauthErrorMessage(params.get('error')))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    const result =
      mode === 'sign-up'
        ? await authClient.signUp.email({ name: '', email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password })
    if (result.error) {
      setBusy(false)
      setError(authErrorMessage(result.error))
      return
    }
    if (!result.data.user.emailVerified) {
      // Signed in but unverified: send the code, then ask for it.
      try {
        await sendVerificationCode(email)
      } catch {
        // The verify screen offers a resend.
      }
      navigate('/verify', { replace: true, state: { sent: true } })
      return
    }
    navigate('/', { replace: true })
  }

  return { email, setEmail, password, setPassword, busy, error, setError, submit }
}

export default function SignIn({ mode }: { mode: Mode }) {
  const location = useLocation()
  const form = useCredentials(mode)
  const copy = COPY[mode]
  const notice = (location.state as { notice?: string } | null)?.notice

  return (
    <AuthLayout
      title={copy.title}
      subtitle={copy.subtitle}
      footer={
        mode === 'sign-in' ? (
          <>
            <span>
              New here? <Link to="/sign-up">Create an account</Link>
            </span>
            <Link to="/forgot-password">Forgot your password?</Link>
          </>
        ) : (
          <span>
            Already have an account? <Link to="/sign-in">Sign in</Link>
          </span>
        )
      }
    >
      {notice && <Alert tone="success">{notice}</Alert>}
      {form.error && <Alert tone="error">{form.error}</Alert>}
      <GoogleButton onError={form.setError} />
      <Divider label="or use email" />
      <form onSubmit={(e) => void form.submit(e)} className={authStyles.form}>
        <TextInput
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={(e) => form.setEmail(e.target.value)}
          data-testid="email-input"
        />
        <TextInput
          label="Password"
          type="password"
          autoComplete={copy.autoComplete}
          required
          minLength={mode === 'sign-up' ? MIN_PASSWORD_LENGTH : undefined}
          hint={mode === 'sign-up' ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
          value={form.password}
          onChange={(e) => form.setPassword(e.target.value)}
          data-testid="password-input"
        />
        <Button type="submit" block loading={form.busy} data-testid="submit-button">
          {copy.button}
        </Button>
      </form>
    </AuthLayout>
  )
}
