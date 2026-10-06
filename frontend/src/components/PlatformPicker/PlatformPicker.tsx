import { Picker, PickerOption, PickerOptions } from '../Picker/Picker'
import { PLATFORMS } from '../../lib/platforms'
import type { Platform } from '../../lib/types'
import PlatformIcon from '../PlatformIcon/PlatformIcon'

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
    <Picker legend="Images for" disabled={disabled}>
      <PickerOptions columns={3}>
        {PLATFORMS.map((p) => (
          <PickerOption
            key={p.id}
            type="checkbox"
            checked={selected.includes(p.id)}
            onChange={() => toggle(p.id)}
            testId={`platform-${p.id}`}
            label={p.label}
            meta={`${p.shape}, ${p.width} × ${p.height}`}
            icon={<PlatformIcon platform={p.id} size={22} />}
          />
        ))}
      </PickerOptions>
    </Picker>
  )
}
