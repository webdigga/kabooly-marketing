import fieldStyles from '../Field/Field.module.css'
import styles from './ToneScale.module.css'

interface ToneScaleProps {
  value: number
  onChange: (value: number) => void
  options: { value: number; label: string }[]
}

// Formal through to casual, as five choices rather than a slider so each
// step has a name.
export default function ToneScale({ value, onChange, options }: ToneScaleProps) {
  return (
    <fieldset className={`${fieldStyles.field} ${styles.fieldset}`}>
      <legend className={fieldStyles.label}>Tone of voice</legend>
      <p className={fieldStyles.hint}>How your adverts should sound, from formal to casual.</p>
      <div className={styles.scale}>
        {options.map((option) => (
          <label key={option.value} className={[styles.option, value === option.value && styles.selected].filter(Boolean).join(' ')}>
            <input
              type="radio"
              name="tone"
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="visually-hidden"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
