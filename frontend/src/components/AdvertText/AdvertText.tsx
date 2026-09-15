import { RefreshCw, Save } from 'lucide-react'
import { useState } from 'react'
import Button from '../Button/Button'
import CopyButton from '../CopyButton/CopyButton'
import fieldStyles from '../Field/Field.module.css'
import styles from './AdvertText.module.css'

interface EditableProps {
  body: string
  onSave: (body: string) => Promise<void>
  onRegenerate: () => void
  regenerating: boolean
  disabled?: boolean
}

// The advert text, edited in place. Copy always copies what is on screen,
// saved or not.
export function EditableAdvertText({ body, onSave, onRegenerate, regenerating, disabled }: EditableProps) {
  const [text, setText] = useState(body)
  const [prev, setPrev] = useState(body)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (body !== prev) {
    setPrev(body)
    setText(body)
  }
  const edited = text.trim() !== body.trim()

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await onSave(text)
    } catch {
      setError('Your changes could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.block}>
      <label className="visually-hidden" htmlFor="advert-text">
        Advert text
      </label>
      <textarea
        id="advert-text"
        className={`${fieldStyles.control} ${styles.editor}`}
        value={text}
        maxLength={5000}
        onChange={(e) => setText(e.target.value)}
        disabled={regenerating}
        data-testid="advert-text"
      />
      {error && (
        <p className={fieldStyles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <CopyButton text={text} testId="copy-text" />
        {edited && (
          <>
            <Button size="sm" icon={<Save size={16} aria-hidden="true" />} loading={saving} onClick={() => void save()} disabled={!text.trim()} data-testid="save-text">
              Save changes
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setText(body)}>
              Undo changes
            </Button>
          </>
        )}
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw size={16} aria-hidden="true" />}
          loading={regenerating}
          disabled={disabled}
          onClick={onRegenerate}
          data-testid="regenerate-text"
        >
          Regenerate text
        </Button>
      </div>
    </div>
  )
}

export function ReadOnlyAdvertText({ body }: { body: string }) {
  return (
    <div className={styles.block}>
      <p className={styles.readOnly}>{body}</p>
      <div className={styles.actions}>
        <CopyButton text={body} />
      </div>
    </div>
  )
}
