import { api } from './api'

// The better-auth emailOTP endpoints, called the same way TrackShows does
// (onnext/frontend/src/app/sign-in.tsx and forgot-password.tsx).

export async function sendVerificationCode(email: string): Promise<void> {
  await api('/api/auth/email-otp/send-verification-otp', {
    body: { email: email.trim(), type: 'email-verification' },
  })
}

export async function verifyEmail(email: string, otp: string): Promise<void> {
  await api('/api/auth/email-otp/verify-email', { body: { email: email.trim(), otp: otp.trim() } })
}

export async function requestPasswordReset(email: string): Promise<void> {
  await api('/api/auth/email-otp/request-password-reset', { body: { email: email.trim() } })
}

export async function resetPassword(email: string, otp: string, password: string): Promise<void> {
  await api('/api/auth/email-otp/reset-password', {
    body: { email: email.trim(), otp: otp.trim(), password },
  })
}

export const MIN_PASSWORD_LENGTH = 8
