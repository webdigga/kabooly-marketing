import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Inactive from '../components/Inactive/Inactive'
import LoadError from '../components/LoadError/LoadError'
import PageLoader from '../components/PageLoader/PageLoader'
import { api, ApiError } from '../lib/api'
import { authClient } from '../lib/auth-client'
import type { Profile } from '../lib/types'

interface ProfileContextValue {
  profile: Profile | null
  setProfile: (profile: Profile) => void
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export function useProfile(): ProfileContextValue {
  const value = useContext(ProfileContext)
  if (!value) throw new Error('useProfile must be used inside ProfileProvider')
  return value
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'inactive' }
  | { status: 'signedOut' }
  | { status: 'ready'; profile: Profile | null }

// Loads the business profile once per session. Its absence is what sends a
// new account to onboarding.
export function ProfileProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const { refetch } = authClient.useSession()

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const { profile } = await api<{ profile: Profile | null }>('/api/profile')
      setState({ status: 'ready', profile })
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0
      // 401: the session has just ended (signing out briefly leaves the
      // browser's copy of the session behind). Refreshing it lets the guard
      // send the user to sign in, instead of flashing a load error.
      if (status === 401) {
        setState({ status: 'signedOut' })
        void refetch()
        return
      }
      // 402: signed in, but the subscription has lapsed or been cancelled.
      setState({ status: status === 402 ? 'inactive' : 'error' })
    }
  }, [refetch])

  useEffect(() => {
    // Loading on mount is exactly what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const setProfile = useCallback((profile: Profile) => setState({ status: 'ready', profile }), [])

  if (state.status === 'loading' || state.status === 'signedOut') return <PageLoader />
  if (state.status === 'inactive') return <Inactive />
  if (state.status === 'error') {
    return <LoadError message="Could not load your account. Check your connection and try again." onRetry={() => void load()} />
  }
  return (
    <ProfileContext.Provider value={{ profile: state.profile, setProfile }}>{children}</ProfileContext.Provider>
  )
}
