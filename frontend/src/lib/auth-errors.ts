const FRIENDLY: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'That email and password do not match.',
  USER_ALREADY_EXISTS: 'An account with this email already exists. Sign in instead.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account with this email already exists. Sign in instead.',
  PASSWORD_TOO_SHORT: 'Use at least 8 characters for your password.',
  PASSWORD_TOO_LONG: 'That password is too long.',
  INVALID_EMAIL: 'Enter a valid email address.',
}

export function authErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  if (error?.code && FRIENDLY[error.code]) return FRIENDLY[error.code]!
  return error?.message || 'Something went wrong. Try again.'
}

export const NOT_LINKED_MESSAGE =
  'This email already has a Kabooly Marketing account. Sign in with your email and password once to verify it, then Google will work.'

// A failed Google round trip lands back on /sign-in?error=<code>.
export function oauthErrorMessage(code: string | null): string | null {
  if (!code) return null
  return code === 'account_not_linked' ? NOT_LINKED_MESSAGE : 'Could not sign in with Google. Try again.'
}
