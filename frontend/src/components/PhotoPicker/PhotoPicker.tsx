import { Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { PHOTO_ACCEPT, PHOTO_RULES, PhotoError, uploadPhoto } from '../../lib/photo-upload'
import type { UploadedPhoto } from '../../lib/types'
import Button from '../Button/Button'
import fieldStyles from '../Field/Field.module.css'
import styles from './PhotoPicker.module.css'

interface PhotoPickerProps {
  photo: UploadedPhoto | null
  onChange: (photo: UploadedPhoto | null) => void
  disabled?: boolean
}

// Chooses and uploads the customer's own photo, explaining the rules first
// and any problem with the file before it is sent.
export default function PhotoPicker({ photo, onChange, disabled }: PhotoPickerProps) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(file: File) {
    setBusy(true)
    setError(null)
    try {
      onChange(await uploadPhoto(file))
    } catch (err) {
      setError(err instanceof PhotoError ? err.message : 'That photo could not be uploaded. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={fieldStyles.field}>
      <span className={fieldStyles.label}>Your photo</span>
      <p className={fieldStyles.hint}>{PHOTO_RULES} We crop it for each platform and add your logo.</p>
      {photo && (
        <div className={styles.preview}>
          <img src={photo.url} alt="Your photo" data-testid="photo-preview" />
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept={PHOTO_ACCEPT}
        className="visually-hidden"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void choose(file)
        }}
        data-testid="photo-file"
      />
      <div>
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          disabled={disabled}
          icon={<Upload size={16} aria-hidden="true" />}
          onClick={() => input.current?.click()}
        >
          {photo ? 'Choose a different photo' : 'Choose a photo'}
        </Button>
      </div>
      {error && (
        <p className={fieldStyles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
