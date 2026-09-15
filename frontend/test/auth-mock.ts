import { vi } from 'vitest'

// Stand-in for the better-auth client. Each page test mocks
// src/lib/auth-client with this; it must not import the app (the mock
// factory would then import itself).

export interface FakeUser {
  id: string
  email: string
  emailVerified: boolean
}

export const session: { current: { user: FakeUser } | null } = { current: null }

export function signedIn(emailVerified = true): void {
  session.current = { user: { id: 'u1', email: 'owner@example.com', emailVerified } }
}

export function signedOut(): void {
  session.current = null
}

export const authMock = {
  useSession: () => ({ data: session.current, isPending: false, error: null, refetch: authMock.refetch }),
  refetch: vi.fn(async () => undefined),
  signIn: { email: vi.fn(), social: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(async () => {
    session.current = null
    return { data: { success: true }, error: null }
  }),
}

