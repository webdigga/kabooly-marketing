import { Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import fieldStyles from '../Field/Field.module.css'
import Button from '../Button/Button'
import styles from './ServicesEditor.module.css'

interface ServicesEditorProps {
  services: string[]
  onChange: (services: string[]) => void
  max: number
  error?: string
}

// One service or product per item, added one at a time.
export default function ServicesEditor({ services, onChange, max, error }: ServicesEditorProps) {
  const id = useId()
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const full = services.length >= max

  function add() {
    const name = draft.trim()
    if (!name) return
    if (services.some((s) => s.toLowerCase() === name.toLowerCase())) {
      setNotice(`${name} is already on the list.`)
      return
    }
    onChange([...services, name])
    setDraft('')
    setNotice(null)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      add()
    }
  }

  return (
    <div className={fieldStyles.field}>
      <label htmlFor={id} className={fieldStyles.label}>
        Services or products
      </label>
      <p className={fieldStyles.hint}>Add each one separately, for example &ldquo;Oven cleaning&rdquo;.</p>
      {services.length > 0 && (
        <ul className={styles.list} data-testid="services-list">
          {services.map((service) => (
            <li key={service} className={styles.item}>
              <span>{service}</span>
              <button
                type="button"
                className={styles.remove}
                onClick={() => {
                  setNotice(null)
                  onChange(services.filter((s) => s !== service))
                }}
                aria-label={`Remove ${service}`}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.addRow}>
        <input
          id={id}
          className={fieldStyles.control}
          value={draft}
          maxLength={100}
          disabled={full}
          placeholder={full ? `Up to ${max} items` : 'Add a service or product'}
          onChange={(e) => {
            setDraft(e.target.value)
            setNotice(null)
          }}
          onKeyDown={onKeyDown}
          aria-invalid={error ? true : undefined}
          data-testid="service-input"
        />
        <Button variant="secondary" icon={<Plus size={18} aria-hidden="true" />} onClick={add} disabled={full || !draft.trim()} data-testid="add-service">
          Add
        </Button>
      </div>
      {(error || notice) && (
        <p className={fieldStyles.error} role="alert">
          {notice ?? error}
        </p>
      )}
    </div>
  )
}
