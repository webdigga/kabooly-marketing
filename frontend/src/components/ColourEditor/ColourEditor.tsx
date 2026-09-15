import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import fieldStyles from '../Field/Field.module.css'
import Button from '../Button/Button'
import styles from './ColourEditor.module.css'

const HEX = /^#[0-9a-f]{6}$/i

interface ColourEditorProps {
  colours: string[]
  onChange: (colours: string[]) => void
  max: number
}

function Swatch({ colour, index, onSet, onRemove }: { colour: string; index: number; onSet: (c: string) => void; onRemove: () => void }) {
  // Typing is free; only a complete #rrggbb is committed.
  const [text, setText] = useState(colour)
  const [prev, setPrev] = useState(colour)
  if (colour !== prev) {
    setPrev(colour)
    setText(colour)
  }
  return (
    <li className={styles.swatch}>
      <input
        type="color"
        className={styles.picker}
        value={colour}
        onChange={(e) => onSet(e.target.value)}
        aria-label={`Colour ${index + 1} picker`}
      />
      <input
        className={`${fieldStyles.control} ${styles.hex}`}
        value={text}
        maxLength={7}
        spellCheck={false}
        aria-label={`Colour ${index + 1} hex code`}
        aria-invalid={HEX.test(text) ? undefined : true}
        onChange={(e) => {
          const value = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
          setText(value)
          if (HEX.test(value)) onSet(value.toLowerCase())
        }}
        data-testid={`colour-hex-${index}`}
      />
      <button type="button" className={styles.remove} onClick={onRemove} aria-label={`Remove colour ${index + 1}`}>
        <X size={16} aria-hidden="true" />
      </button>
    </li>
  )
}

export default function ColourEditor({ colours, onChange, max }: ColourEditorProps) {
  return (
    <div className={fieldStyles.field}>
      <span className={fieldStyles.label}>Brand colours</span>
      <p className={fieldStyles.hint}>Used as accents in your advert images. Main colour first.</p>
      {colours.length > 0 && (
        <ul className={styles.list} data-testid="colour-list">
          {colours.map((colour, index) => (
            <Swatch
              key={index}
              colour={colour}
              index={index}
              onSet={(c) => onChange(colours.map((old, i) => (i === index ? c : old)))}
              onRemove={() => onChange(colours.filter((_, i) => i !== index))}
            />
          ))}
        </ul>
      )}
      {colours.length < max && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={() => onChange([...colours, '#1d4ed8'])}
            data-testid="add-colour"
          >
            Add colour
          </Button>
        </div>
      )}
    </div>
  )
}
