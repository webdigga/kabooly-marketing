import { Camera, Clapperboard, GalleryHorizontal, Images } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './FormatPicker.module.css'

export type CreateFormat = 'images' | 'photo' | 'carousel' | 'video'

interface Option {
  id: CreateFormat
  label: string
  detail: string
  icon: ReactNode
}

const OPTIONS: Option[] = [
  { id: 'images', label: 'Advert with images', detail: 'Text plus an image for each platform', icon: <Images size={20} aria-hidden="true" /> },
  { id: 'photo', label: 'Post from your photo', detail: 'Your own photo, sized and branded', icon: <Camera size={20} aria-hidden="true" /> },
  { id: 'carousel', label: 'Carousel', detail: 'Five swipeable slides', icon: <GalleryHorizontal size={20} aria-hidden="true" /> },
  { id: 'video', label: 'Video', detail: 'For Reels, Shorts, TikTok and Stories', icon: <Clapperboard size={20} aria-hidden="true" /> },
]

interface FormatPickerProps {
  value: CreateFormat
  onChange: (format: CreateFormat) => void
  disabled?: boolean
}

// The first choice on the create screen: what to make.
export default function FormatPicker({ value, onChange, disabled }: FormatPickerProps) {
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.legend}>What do you want to make?</legend>
      <div className={styles.options}>
        {OPTIONS.map((option) => {
          const checked = option.id === value
          return (
            <label key={option.id} className={[styles.option, checked && styles.checked].filter(Boolean).join(' ')}>
              <input
                type="radio"
                name="format"
                className="visually-hidden"
                checked={checked}
                onChange={() => onChange(option.id)}
                data-testid={`format-${option.id}`}
              />
              <span className={styles.icon}>{option.icon}</span>
              <span className={styles.text}>
                <span className={styles.name}>{option.label}</span>
                <span className={styles.meta}>{option.detail}</span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
