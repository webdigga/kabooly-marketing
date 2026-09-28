import { Camera, Check, Shapes } from 'lucide-react'
import type { ImageStyle, Look } from '../../lib/types'
import styles from './LookPicker.module.css'

interface Option {
  id: ImageStyle
  label: string
  meta: string
  icon: typeof Camera
}

const OPTIONS: Option[] = [
  { id: 'photo', label: 'Photo', meta: 'A realistic photograph of a real scene', icon: Camera },
  { id: 'graphic', label: 'Designed graphic', meta: 'Shapes and colour, no people', icon: Shapes },
]

interface LookPickerProps {
  look: Look
  onChange: (look: Look) => void
  disabled?: boolean
  // Carousels lay out their own branding, so the logo choice is not offered.
  allowLogo?: boolean
}

export default function LookPicker({ look, onChange, disabled, allowLogo = true }: LookPickerProps) {
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.legend}>Look</legend>
      <div className={styles.options}>
        {OPTIONS.map((option) => {
          const checked = look.style === option.id
          const Icon = option.icon
          return (
            <label key={option.id} className={[styles.option, checked && styles.checked].filter(Boolean).join(' ')}>
              <input
                type="radio"
                name="look"
                className="visually-hidden"
                checked={checked}
                onChange={() => onChange({ ...look, style: option.id })}
                data-testid={`look-${option.id}`}
              />
              <span className={[styles.box, styles.round].join(' ')} aria-hidden="true">
                {checked && <Check size={14} />}
              </span>
              <Icon size={22} aria-hidden="true" />
              <span className={styles.text}>
                <span className={styles.name}>{option.label}</span>
                <span className={styles.meta}>{option.meta}</span>
              </span>
            </label>
          )
        })}
      </div>
      {allowLogo && (
        <label className={[styles.option, look.logo && styles.checked].filter(Boolean).join(' ')}>
          <input
            type="checkbox"
            className="visually-hidden"
            checked={look.logo}
            onChange={() => onChange({ ...look, logo: !look.logo })}
            data-testid="look-logo"
          />
          <span className={styles.box} aria-hidden="true">
            {look.logo && <Check size={14} />}
          </span>
          <span className={styles.text}>
            <span className={styles.name}>Put my logo inside the picture</span>
            <span className={styles.meta}>
              The design is built around your logo instead of the band along the bottom. Worth trying, and worth checking: the
              logo is copied into a drawing, so look before you post.
            </span>
          </span>
        </label>
      )}
    </fieldset>
  )
}
