import { useCallback, useState } from 'react'
import { api, ApiError } from '../lib/api'
import type { Profile } from '../lib/types'
import { draftToBody, fieldFromServer } from './draft'
import type { DraftErrors, DraftField, ProfileDraft } from './draft'

// Holds an editable copy of the profile and saves it. Shared by onboarding
// and settings so both validate and save the same way.
export function useProfileDraft(initial: ProfileDraft) {
  const [draft, setDraft] = useState(initial)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [saving, setSaving] = useState(false)

  const update = useCallback(<K extends DraftField>(field: K, value: ProfileDraft[K]) => {
    setDraft((d) => ({ ...d, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }, [])

  // Returns the saved profile. On failure, marks the field the server
  // rejected (if it named one) and rethrows.
  async function save(): Promise<Profile> {
    setSaving(true)
    try {
      const { profile } = await api<{ profile: Profile }>('/api/profile', { method: 'PUT', body: draftToBody(draft) })
      return profile
    } catch (err) {
      const field = err instanceof ApiError ? fieldFromServer(err.body.field) : null
      setErrors(field ? { [field]: 'Check this and try again.' } : {})
      throw err
    } finally {
      setSaving(false)
    }
  }

  return { draft, setDraft, update, errors, setErrors, saving, save }
}
