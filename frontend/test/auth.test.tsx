import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authMock, callsTo, json, mockApi, PROFILE, renderApp, session, signedIn, signedOut, USAGE } from './helpers'

vi.mock('../src/lib/auth-client', async () => ({ authClient: (await import('./auth-mock')).authMock }))

const appRoutes = {
  'GET /api/profile': () => json({ profile: PROFILE }),
  'GET /api/usage': () => json(USAGE),
  'POST /api/topics/suggest': () => json({ topic: 'Spring ovens' }),
  'POST /api/auth/email-otp/send-verification-otp': () => json({ success: true }),
  'POST /api/auth/email-otp/verify-email': () => json({ status: true }),
  'POST /api/auth/email-otp/request-password-reset': () => json({ success: true }),
  'POST /api/auth/email-otp/reset-password': () => json({ success: true }),
  'POST /api/auth/reset-password': () => json({ status: true }),
}

beforeEach(() => {
  signedOut()
  mockApi(appRoutes)
  authMock.signIn.email.mockReset()
  authMock.signIn.social.mockReset()
})

function location() {
  return screen.getByTestId('location').textContent
}

async function fillCredentials(email: string, password: string) {
  await userEvent.type(screen.getByTestId('email-input'), email)
  await userEvent.type(screen.getByTestId('password-input'), password)
  await userEvent.click(screen.getByTestId('submit-button'))
}

describe('route guards', () => {
  it('sends signed-out visitors to sign in', () => {
    renderApp('/library')
    expect(location()).toBe('/sign-in')
  })

  it('sends unverified accounts to the verify screen', () => {
    signedIn(false)
    renderApp('/')
    expect(location()).toBe('/verify')
  })

  it('keeps signed-in people away from the sign-in screen', async () => {
    signedIn()
    renderApp('/sign-in')
    await screen.findByRole('heading', { name: 'Image advert' })
    expect(location()).toBe('/')
  })

  it('sends an unknown address home', async () => {
    signedIn()
    renderApp('/nowhere')
    await screen.findByRole('heading', { name: 'Image advert' })
  })
})

describe('sign in', () => {
  it('signs a verified account straight into the app', async () => {
    authMock.signIn.email.mockImplementation(async () => {
      signedIn(true)
      return { data: { user: session.current?.user }, error: null }
    })
    renderApp('/sign-in')
    await fillCredentials('owner@example.com', 'secret-password')
    await screen.findByRole('heading', { name: 'Image advert' })
    expect(authMock.signIn.email).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'secret-password' })
  })

  it('sends an unverified account a code and asks for it', async () => {
    authMock.signIn.email.mockImplementation(async () => {
      signedIn(false)
      return { data: { user: session.current?.user }, error: null }
    })
    renderApp('/sign-in')
    await fillCredentials('owner@example.com', 'secret-password')
    await screen.findByText(/We sent a 6-digit code to owner@example.com/)
    expect(callsTo('POST', '/api/auth/email-otp/send-verification-otp')[0]?.body).toEqual({
      email: 'owner@example.com',
      type: 'email-verification',
    })
  })

  it('shows a friendly message for a wrong password', async () => {
    authMock.signIn.email.mockResolvedValue({ data: null, error: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid' } })
    renderApp('/sign-in')
    await fillCredentials('owner@example.com', 'wrong-password')
    expect(await screen.findByRole('alert')).toHaveTextContent('That email and password do not match.')
  })

  it('explains a Google sign-in into an unverified email account', () => {
    renderApp('/sign-in?error=account_not_linked')
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in with your email and password once to verify it')
  })

  it('starts Google sign-in with the redirect flow', async () => {
    authMock.signIn.social.mockResolvedValue({ data: { url: 'https://accounts.google.com' }, error: null })
    renderApp('/sign-in')
    await userEvent.click(screen.getByTestId('google-sign-in'))
    expect(authMock.signIn.social).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google', errorCallbackURL: `${window.location.origin}/sign-in` }),
    )
  })

  it('reports a Google sign-in that could not start', async () => {
    authMock.signIn.social.mockResolvedValue({ data: null, error: { message: 'x' } })
    renderApp('/sign-in')
    await userEvent.click(screen.getByTestId('google-sign-in'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start Google sign-in')
  })
})

describe('no sign up', () => {
  it('has no sign-up page and points new customers at kabooly.com', async () => {
    renderApp('/sign-up')
    expect(location()).toBe('/sign-in')
    expect(screen.queryByText(/create an account/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Get Kabooly Marketing' })).toHaveAttribute(
      'href',
      'https://kabooly.com/marketing/',
    )
  })

  it('explains a Google sign-in for an email with no account', () => {
    renderApp('/sign-in?error=signup_disabled')
    expect(screen.getByRole('alert')).toHaveTextContent('There is no Kabooly Marketing account for that Google email')
  })
})

describe('set password', () => {
  it('saves the password from the emailed link and sends the customer to sign in', async () => {
    renderApp('/set-password?token=abc123')
    await userEvent.type(screen.getByTestId('password-input'), 'a-long-password')
    await userEvent.type(screen.getByTestId('confirm-input'), 'a-long-password')
    await userEvent.click(screen.getByTestId('set-password'))
    await screen.findByText('Password saved. Sign in to get started.')
    expect(location()).toBe('/sign-in')
    expect(callsTo('POST', '/api/auth/reset-password')[0]?.body).toEqual({
      token: 'abc123',
      newPassword: 'a-long-password',
    })
  })

  it('refuses two different passwords without calling the server', async () => {
    renderApp('/set-password?token=abc123')
    await userEvent.type(screen.getByTestId('password-input'), 'a-long-password')
    await userEvent.type(screen.getByTestId('confirm-input'), 'another-password')
    await userEvent.click(screen.getByTestId('set-password'))
    expect(await screen.findByRole('alert')).toHaveTextContent('The two passwords do not match.')
    expect(callsTo('POST', '/api/auth/reset-password')).toHaveLength(0)
  })

  it('explains an expired or used link', async () => {
    mockApi({ ...appRoutes, 'POST /api/auth/reset-password': () => json({ code: 'INVALID_TOKEN' }, 400) })
    renderApp('/set-password?token=old')
    await userEvent.type(screen.getByTestId('password-input'), 'a-long-password')
    await userEvent.type(screen.getByTestId('confirm-input'), 'a-long-password')
    await userEvent.click(screen.getByTestId('set-password'))
    expect(await screen.findByRole('alert')).toHaveTextContent('This link has expired or has already been used.')
  })

  it('flags a link with no token', () => {
    renderApp('/set-password')
    expect(screen.getByRole('alert')).toHaveTextContent('This link is incomplete.')
    expect(screen.getByTestId('set-password')).toBeDisabled()
  })
})

describe('paused subscription', () => {
  it('shows the paused screen instead of the app and lets the customer sign out', async () => {
    signedIn()
    mockApi({ ...appRoutes, 'GET /api/profile': () => json({ error: 'Subscription inactive', code: 'SUBSCRIPTION_INACTIVE' }, 402) })
    renderApp('/')
    await screen.findByRole('heading', { name: 'Your account is paused' })
    await userEvent.click(screen.getByTestId('inactive-sign-out'))
    expect(authMock.signOut).toHaveBeenCalled()
  })
})

describe('verify email', () => {
  it('verifies with the code and continues into the app', async () => {
    signedIn(false)
    authMock.refetch.mockImplementation(async () => {
      signedIn(true)
    })
    renderApp('/verify')
    await userEvent.type(screen.getByTestId('otp-input'), '12a3456')
    await userEvent.click(screen.getByTestId('verify-button'))
    await screen.findByRole('heading', { name: 'Image advert' })
    expect(callsTo('POST', '/api/auth/email-otp/verify-email')[0]?.body).toEqual({ email: 'owner@example.com', otp: '123456' })
  })

  it('says when a code is wrong', async () => {
    signedIn(false)
    mockApi({ ...appRoutes, 'POST /api/auth/email-otp/verify-email': () => json({ message: 'Invalid OTP' }, 400) })
    renderApp('/verify')
    await userEvent.type(screen.getByTestId('otp-input'), '000000')
    await userEvent.click(screen.getByTestId('verify-button'))
    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work')
  })

  it('sends a new code', async () => {
    signedIn(false)
    renderApp('/verify')
    await userEvent.click(screen.getByTestId('resend-code'))
    expect(await screen.findByText('We sent a new code to owner@example.com.')).toBeInTheDocument()
  })

  it('reports a failed resend', async () => {
    signedIn(false)
    mockApi({ ...appRoutes, 'POST /api/auth/email-otp/send-verification-otp': () => json({}, 500) })
    renderApp('/verify')
    await userEvent.click(screen.getByTestId('resend-code'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send the code')
  })

  it('lets someone switch account', async () => {
    signedIn(false)
    renderApp('/verify')
    await userEvent.click(screen.getByTestId('cancel-verify'))
    await waitFor(() => expect(location()).toBe('/sign-in'))
    expect(authMock.signOut).toHaveBeenCalled()
  })

  it('sends people without a session to sign in', () => {
    renderApp('/verify')
    expect(location()).toBe('/sign-in')
  })
})

describe('password reset', () => {
  it('resets with an emailed code, then asks for a fresh sign in', async () => {
    renderApp('/forgot-password')
    await userEvent.type(screen.getByTestId('email-input'), 'owner@example.com')
    await userEvent.click(screen.getByTestId('send-code'))
    await userEvent.type(await screen.findByTestId('otp-input'), '654321')
    await userEvent.type(screen.getByTestId('password-input'), 'a-new-password')
    await userEvent.click(screen.getByTestId('reset-password'))
    expect(await screen.findByText('Password changed. Sign in with your new password.')).toBeInTheDocument()
    expect(callsTo('POST', '/api/auth/email-otp/reset-password')[0]?.body).toEqual({
      email: 'owner@example.com',
      otp: '654321',
      password: 'a-new-password',
    })
  })

  it('reports failures at each step', async () => {
    mockApi({
      ...appRoutes,
      'POST /api/auth/email-otp/request-password-reset': () => json({}, 500),
    })
    renderApp('/forgot-password')
    await userEvent.type(screen.getByTestId('email-input'), 'owner@example.com')
    await userEvent.click(screen.getByTestId('send-code'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send the code')

    mockApi({ ...appRoutes, 'POST /api/auth/email-otp/reset-password': () => json({}, 400) })
    await userEvent.click(screen.getByTestId('send-code'))
    await userEvent.type(await screen.findByTestId('otp-input'), '000000')
    await userEvent.type(screen.getByTestId('password-input'), 'a-new-password')
    await userEvent.click(screen.getByTestId('reset-password'))
    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work')
  })
})
