import { Check } from 'lucide-react'
import { PLATFORMS } from '../../lib/platforms'
import type { Platform } from '../../lib/types'
import styles from './PlatformPicker.module.css'

interface PlatformPickerProps {
  selected: Platform[]
  onChange: (selected: Platform[]) => void
  disabled?: boolean
}

export default function PlatformPicker({ selected, onChange, disabled }: PlatformPickerProps) {
  function toggle(platform: Platform) {
    onChange(selected.includes(platform) ? selected.filter((p) => p !== platform) : [...selected, platform])
  }
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.legend}>Images for</legend>
      <div className={styles.options}>
        {PLATFORMS.map((p) => {
          const checked = selected.includes(p.id)
          return (
            <label key={p.id} className={[styles.option, checked && styles.checked].filter(Boolean).join(' ')}>
              <input
                type="checkbox"
                className="visually-hidden"
                checked={checked}
                onChange={() => toggle(p.id)}
                data-testid={`platform-${p.id}`}
              />
              <span className={styles.box} aria-hidden="true">
                {checked && <Check size={14} />}
              </span>
              <span className={styles.text}>
                <span className={styles.name}>{p.label}</span>
                <span className={styles.meta}>
                  {p.shape}, {p.width} × {p.height}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
