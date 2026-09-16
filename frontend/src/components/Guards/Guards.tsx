import { Navigate, Outlet } from 'react-router-dom'
import { ProfileProvider, useProfile } from '../../context/ProfileContext'
import { authClient } from '../../lib/auth-client'
import PageLoader from '../PageLoader/PageLoader'

// Sign-in, choosing a password and password reset: only for people who are
// signed out.
export function GuestOnly() {
  const { data: session, isPending } = authClient.useSession()
  if (isPending) return <PageLoader />
  if (session) return <Navigate to={session.user.emailVerified ? '/' : '/verify'} replace />
  return <Outlet />
}

// Everything in the app: a signed-in account with a verified email.
export function RequireVerified() {
  const { data: session, isPending } = authClient.useSession()
  if (isPending) return <PageLoader />
  if (!session) return <Navigate to="/sign-in" replace />
  if (!session.user.emailVerified) return <Navigate to="/verify" replace />
  return (
    <ProfileProvider>
      <Outlet />
    </ProfileProvider>
  )
}

// The generator, library and settings need a business profile; the first
// visit after verification goes through onboarding instead.
export function RequireProfile() {
  const { profile } = useProfile()
  if (!profile) return <Navigate to="/onboarding" replace />
  return <Outlet />
}
