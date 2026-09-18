import { Download, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useProfile } from '../../context/ProfileContext'
import { websiteLabel } from '../../lib/brand-strip'
import { PLATFORM_INFO } from '../../lib/platforms'
import { saveBlob } from '../../lib/slide-render'
import { renderStory } from '../../lib/story-render'
import type { AdvertImage, StoryWords } from '../../lib/types'
import Alert from '../Alert/Alert'
import Button from '../Button/Button'
import styles from './StoryTile.module.css'

interface StoryTileProps {
  image: AdvertImage
  words: StoryWords
  // Omitted in the library, where stories are download only.
  onRegenerate?: () => void
  disabled?: boolean
}

// The preview of the brand strip drawn along the bottom of the finished
// story (lib/story-render.ts draws the real one).
function Strip({ logoUrl, website, colour }: { logoUrl: string | null; website: string; colour: string }) {
  if (!logoUrl && !website) return null
  return (
    <div className={styles.strip} style={{ borderTopColor: colour }} data-testid="story-strip">
      {logoUrl && <img className={styles.logo} src={logoUrl} alt="" />}
      {website && (
        <span className={styles.website} style={{ color: colour }}>
          {website}
        </span>
      )}
    </div>
  )
}

// An Instagram Story: the photo with its words and logo drawn over it,
// clear of the areas Instagram covers with its own controls. The finished
// image is drawn here in the browser when it is downloaded.
export default function StoryTile({ image, words, onRegenerate, disabled }: StoryTileProps) {
  const { profile } = useProfile()
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const info = PLATFORM_INFO.story
  const colour = profile?.brandColours[0] ?? '#1d4ed8'
  const website = websiteLabel(profile?.websiteUrl ?? '')
  const design = { photo: image.url, logo: profile?.logoUrl ?? null, colour, websiteUrl: profile?.websiteUrl ?? '' }

  async function download() {
    setSaving(true)
    setFailed(false)
    try {
      const blob = await renderStory(design, words)
      saveBlob(blob, `kabooly-story-${new Date().toISOString().slice(0, 10)}.png`)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <figure className={styles.tile} data-testid="image-story">
      <figcaption className={styles.caption}>
        <span className={styles.platform}>{info.label}</span>
        <span className={styles.size}>
          {info.width} × {info.height}
        </span>
      </figcaption>
      <div className={styles.frame} style={{ backgroundImage: `url("${image.url}")` }}>
        <div className={styles.words}>
          <p className={styles.headline}>{words.headline}</p>
          <p className={styles.cta} style={{ backgroundColor: colour }}>
            {words.cta}
          </p>
        </div>
        <Strip logoUrl={profile?.logoUrl ?? null} website={website} colour={colour} />
      </div>
      {failed && <Alert tone="error">The story could not be downloaded. Try again.</Alert>}
      <div className={styles.actions}>
        <Button size="sm" icon={<Download size={16} aria-hidden="true" />} loading={saving} onClick={() => void download()} data-testid="download-story">
          Download
        </Button>
        {onRegenerate && (
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={16} aria-hidden="true" />}
            onClick={onRegenerate}
            disabled={disabled}
            data-testid="regenerate-story"
          >
            Regenerate
          </Button>
        )}
      </div>
    </figure>
  )
}
