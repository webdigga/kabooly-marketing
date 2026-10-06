import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './Picker.module.css'

interface PickerProps {
  legend: string
  disabled?: boolean
  children: ReactNode
}

// The chrome every picker shares: a labelled fieldset of tickable cards.
// Used by PlatformPicker and LookPicker, so the two cannot drift apart.
export function Picker({ legend, disabled, children }: PickerProps) {
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.legend}>{legend}</legend>
      {children}
    </fieldset>
  )
}

export function PickerOptions({ columns, children }: { columns: 2 | 3; children: ReactNode }) {
  return <div className={`${styles.options} ${columns === 3 ? styles.three : styles.two}`}>{children}</div>
}

interface OptionProps {
  // A radio where one choice replaces another, a checkbox where several can
  // be on at once.
  type: 'checkbox' | 'radio'
  name?: string
  checked: boolean
  onChange: () => void
  testId: string
  label: string
  meta?: string
  icon?: ReactNode
  // A round tick box reads as "one of these", like a radio.
  round?: boolean
}

export function PickerOption({ type, name, checked, onChange, testId, label, meta, icon, round }: OptionProps) {
  return (
    <label className={[styles.option, checked && styles.checked].filter(Boolean).join(' ')}>
      <input type={type} name={name} className="visually-hidden" checked={checked} onChange={onChange} data-testid={testId} />
      <span className={[styles.box, round && styles.round].filter(Boolean).join(' ')} aria-hidden="true">
        {checked && <Check size={14} />}
      </span>
      {icon}
      <span className={styles.text}>
        <span className={styles.name}>{label}</span>
        {meta && <span className={styles.meta}>{meta}</span>}
      </span>
    </label>
  )
}
