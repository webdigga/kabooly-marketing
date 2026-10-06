import { Download, Pencil, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useProfile } from '../../context/ProfileContext'
import { headingColour, renderSlide, saveBlob, slideKind } from '../../lib/slide-render'
import type { SlideDesign, SlideKind } from '../../lib/slide-render'
import type { Profile, Slide, StoredFile } from '../../lib/types'
import Alert from '../Alert/Alert'
import Button from '../Button/Button'
import { TextArea, TextInput } from '../Field/Field'
import styles from './CarouselSlides.module.css'

export type BackgroundStatus = 'pending' | 'ready' | 'error'

interface CarouselSlidesProps {
  slides: Slide[]
  background: StoredFile | null
  backgroundStatus: BackgroundStatus
  // Omitted where slides are view and download only.
  onSave?: (slides: Slide[]) => Promise<void>
  onRegenerateSlides?: () => void
  onRegenerateBackground?: () => void
  regenerating?: boolean
  disabled?: boolean
}

// Only slide one carries the picture behind it.
function slideStyle(kind: SlideKind, design: SlideDesign): CSSProperties | undefined {
  if (kind !== 'hook') return undefined
  return {
    backgroundColor: design.colour,
    backgroundImage: design.background ? `url("${design.background}")` : undefined,
  }
}

// The on-screen version of a slide, laid out like renderSlide draws it.
function SlidePreview({ slide, index, total, design }: { slide: Slide; index: number; total: number; design: SlideDesign }) {
  const kind = slideKind(index, total)
  const hook = kind === 'hook'
  return (
    <div className={`${styles.slide} ${styles[kind]}`} style={slideStyle(kind, design)} data-testid={`slide-${index + 1}`}>
      {hook && design.logo && <img className={styles.mark} src={design.logo} alt="" />}
      <div className={styles.words}>
        {kind === 'close' && design.logo && <img className={styles.logo} src={design.logo} alt="" />}
        {hook && design.name && <p className={styles.name}>{design.name}</p>}
        <p className={styles.heading} style={hook ? undefined : { color: headingColour(design.colour) }}>
          {slide.heading}
        </p>
        {slide.body && <p className={styles.body}>{slide.body}</p>}
      </div>
    </div>
  )
}

function SlideEditor({ slides, onSave, onCancel }: { slides: Slide[]; onSave: (slides: Slide[]) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState(slides)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  function change(index: number, patch: Partial<Slide>) {
    setDraft((d) => d.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  async function save() {
    setSaving(true)
    setError(false)
    try {
      await onSave(draft.map((s) => ({ heading: s.heading.trim(), body: s.body.trim() })))
      onCancel()
    } catch {
      setError(true)
      setSaving(false)
    }
  }

  return (
    <div className={styles.editor} data-testid="slide-editor">
      {draft.map((slide, i) => (
        <fieldset key={i} className={styles.editSlide}>
          <legend className={styles.editLegend}>Slide {i + 1}</legend>
          <TextInput label="Heading" value={slide.heading} maxLength={80} onChange={(e) => change(i, { heading: e.target.value })} data-testid={`slide-heading-${i + 1}`} />
          <TextArea label="Text" value={slide.body} maxLength={240} rows={2} onChange={(e) => change(i, { body: e.target.value })} data-testid={`slide-body-${i + 1}`} />
        </fieldset>
      ))}
      {error && <Alert tone="error">Your slides could not be saved. Try again.</Alert>}
      <div className={styles.actions}>
        <Button size="sm" loading={saving} disabled={draft.some((s) => !s.heading.trim())} onClick={() => void save()} data-testid="save-slides">
          Save slides
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

interface SlideActionsProps extends CarouselSlidesProps {
  downloading: boolean
  downloadDisabled: boolean
  onDownloadAll: () => void
  onEdit?: () => void
}

function SlideActions(props: SlideActionsProps) {
  const { onSave, onEdit, onRegenerateSlides, onRegenerateBackground, backgroundStatus, regenerating, disabled } = props
  return (
    <div className={styles.actions}>
      <Button
        size="sm"
        icon={<Download size={16} aria-hidden="true" />}
        loading={props.downloading}
        disabled={props.downloadDisabled}
        onClick={props.onDownloadAll}
        data-testid="download-all-slides"
      >
        Download all slides
      </Button>
      {onSave && onEdit && (
        <Button variant="secondary" size="sm" icon={<Pencil size={16} aria-hidden="true" />} onClick={onEdit} disabled={disabled} data-testid="edit-slides">
          Edit slides
        </Button>
      )}
      {onRegenerateSlides && (
        <Button variant="secondary" size="sm" icon={<RefreshCw size={16} aria-hidden="true" />} loading={regenerating} onClick={onRegenerateSlides} disabled={disabled} data-testid="regenerate-slides">
          Rewrite slides
        </Button>
      )}
      {onRegenerateBackground && (
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw size={16} aria-hidden="true" />}
          loading={backgroundStatus === 'pending'}
          onClick={onRegenerateBackground}
          disabled={disabled}
          data-testid="regenerate-background"
        >
          New photo
        </Button>
      )}
    </div>
  )
}

// Everything the slides are drawn with, from the profile as it stands.
function designOf(profile: Profile | null, background: string | null): SlideDesign {
  return {
    background,
    logo: profile?.logoUrl ?? null,
    colour: profile?.brandColours[0] ?? '#1d4ed8',
    name: profile?.businessName ?? '',
  }
}

interface GridProps {
  slides: Slide[]
  design: SlideDesign
  saving: number | 'all' | null
  disabled: boolean
  onDownload: (index: number) => void
}

// Every slide with its own download button.
function SlideGrid({ slides, design, saving, disabled, onDownload }: GridProps) {
  return (
    <div className={styles.slides}>
      {slides.map((slide, i) => (
        <figure key={i} className={styles.tile}>
          <SlidePreview slide={slide} index={i} total={slides.length} design={design} />
          <Button
            variant="secondary"
            size="sm"
            icon={<Download size={16} aria-hidden="true" />}
            loading={saving === i}
            disabled={disabled}
            onClick={() => onDownload(i)}
            data-testid={`download-slide-${i + 1}`}
          >
            Download
          </Button>
        </figure>
      ))}
    </div>
  )
}

// A carousel's slides, laid out over its background with the brand colour
// and the real logo, each downloadable as a finished image.
// Drawing and saving the slides, which happens in the browser.
function useSlideDownload(design: SlideDesign, slides: Slide[]) {
  const [saving, setSaving] = useState<number | 'all' | null>(null)
  const [failed, setFailed] = useState(false)

  async function download(indexes: number[], which: number | 'all') {
    setSaving(which)
    setFailed(false)
    try {
      for (const i of indexes) saveBlob(await renderSlide(design, slides, i), `kabooly-slide-${i + 1}.png`)
    } catch {
      setFailed(true)
    } finally {
      setSaving(null)
    }
  }

  return { saving, failed, download }
}

// How the first slide's picture is getting on, while it is being made.
function BackgroundNotice({ status }: { status: BackgroundStatus }) {
  if (status === 'pending') {
    return (
      <p className={styles.status} role="status">
        Making the photo for your first slide...
      </p>
    )
  }
  if (status === 'error') {
    return (
      <Alert tone="warning">
        The photo for the first slide could not be made. Make a new one, or download the slides with your brand colour behind the
        first.
      </Alert>
    )
  }
  return null
}

export default function CarouselSlides(props: CarouselSlidesProps) {
  const { slides, background, backgroundStatus, onSave, regenerating } = props
  const { profile } = useProfile()
  const [editing, setEditing] = useState(false)
  const design = designOf(profile, background?.url ?? null)
  const { saving, failed, download } = useSlideDownload(design, slides)
  const busy = backgroundStatus === 'pending' || regenerating

  return (
    <div className={styles.carousel}>
      <BackgroundNotice status={backgroundStatus} />
      <SlideGrid
        slides={slides}
        design={design}
        saving={saving}
        disabled={busy || saving !== null}
        onDownload={(i) => void download([i], i)}
      />
      {failed && <Alert tone="error">The slides could not be downloaded. Try again.</Alert>}
      <SlideActions
        {...props}
        downloading={saving === 'all'}
        downloadDisabled={busy || saving !== null}
        onDownloadAll={() => void download(slides.map((_, i) => i), 'all')}
        onEdit={editing ? undefined : () => setEditing(true)}
      />
      {editing && onSave && <SlideEditor slides={slides} onSave={onSave} onCancel={() => setEditing(false)} />}
    </div>
  )
}
