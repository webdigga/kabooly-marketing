import { createAuthClient } from 'better-auth/react'

// The API shares the app's origin, so the session cookie is first-party and
// better-auth's default /api/auth base path is all that is needed.
export const authClient = createAuthClient({
  baseURL: window.location.origin,
})
