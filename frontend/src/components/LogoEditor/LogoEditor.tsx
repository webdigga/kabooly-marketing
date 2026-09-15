import { ImageOff, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { LOGO_ACCEPT, LogoError, uploadLogoFile } from '../../lib/logo-upload'
import fieldStyles from '../Field/Field.module.css'
import Button from '../Button/Button'
import styles from './LogoEditor.module.css'

interface LogoEditorProps {
  logo: { key: string; url: string } | null
  onChange: (logo: { key: string; url: string } | null) => void
}

export default function LogoEditor({ logo, onChange }: LogoEditorProps) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    try {
      onChange(await uploadLogoFile(file))
    } catch (err) {
      setError(err instanceof LogoError ? err.message : 'Could not upload that logo. Try another image.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={fieldStyles.field}>
      <span className={fieldStyles.label}>Logo</span>
      <p className={fieldStyles.hint}>PNG, JPEG, WebP or SVG, up to 2 MB. It goes into your advert images.</p>
      <div className={styles.row}>
        <div className={styles.preview} data-testid="logo-preview">
          {logo ? (
            <img src={logo.url} alt="Your logo" />
          ) : (
            <ImageOff size={28} aria-label="No logo" className={styles.empty} />
          )}
        </div>
        <div className={styles.actions}>
          <input
            ref={input}
            type="file"
            accept={LOGO_ACCEPT}
            className="visually-hidden"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void upload(file)
            }}
            data-testid="logo-file"
          />
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            icon={<Upload size={16} aria-hidden="true" />}
            onClick={() => input.current?.click()}
          >
            {logo ? 'Replace logo' : 'Upload logo'}
          </Button>
          {logo && (
            <Button variant="danger" size="sm" onClick={() => onChange(null)} data-testid="remove-logo">
              Remove
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p className={fieldStyles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
