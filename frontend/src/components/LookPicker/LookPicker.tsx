import { Camera, Shapes } from 'lucide-react'
import { Picker, PickerOption, PickerOptions } from '../Picker/Picker'
import type { ImageStyle, Look } from '../../lib/types'

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

const LOGO_META =
  'The design is built around your logo instead of the band along the bottom. Worth trying, and worth checking: the logo is copied into a drawing, so look before you post.'

interface LookPickerProps {
  look: Look
  onChange: (look: Look) => void
  disabled?: boolean
  // Carousels lay out their own branding, so the logo choice is not offered.
  allowLogo?: boolean
}

export default function LookPicker({ look, onChange, disabled, allowLogo = true }: LookPickerProps) {
  return (
    <Picker legend="Look" disabled={disabled}>
      <PickerOptions columns={2}>
        {OPTIONS.map((option) => {
          const Icon = option.icon
          return (
            <PickerOption
              key={option.id}
              type="radio"
              name="look"
              round
              checked={look.style === option.id}
              onChange={() => onChange({ ...look, style: option.id })}
              testId={`look-${option.id}`}
              label={option.label}
              meta={option.meta}
              icon={<Icon size={22} aria-hidden="true" />}
            />
          )
        })}
      </PickerOptions>
      {allowLogo && (
        <PickerOption
          type="checkbox"
          checked={look.logo}
          onChange={() => onChange({ ...look, logo: !look.logo })}
          testId="look-logo"
          label="Put my logo inside the picture"
          meta={LOGO_META}
        />
      )}
    </Picker>
  )
}
