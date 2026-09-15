import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import LoadError from '../components/LoadError/LoadError'
import PageLoader from '../components/PageLoader/PageLoader'
import { api } from '../lib/api'
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

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; profile: Profile | null }

// Loads the business profile once per session. Its absence is what sends a
// new account to onboarding.
export function ProfileProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const { profile } = await api<{ profile: Profile | null }>('/api/profile')
      setState({ status: 'ready', profile })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    // Loading on mount is exactly what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const setProfile = useCallback((profile: Profile) => setState({ status: 'ready', profile }), [])

  if (state.status === 'loading') return <PageLoader />
  if (state.status === 'error') {
    return <LoadError message="Could not load your account. Check your connection and try again." onRetry={() => void load()} />
  }
  return (
    <ProfileContext.Provider value={{ profile: state.profile, setProfile }}>{children}</ProfileContext.Provider>
  )
}
