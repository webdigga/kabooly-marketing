import { Download, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useProfile } from '../../context/ProfileContext'
import { websiteLabel } from '../../lib/brand-strip'
import { PLATFORM_INFO } from '../../lib/platforms'
import { saveBlob } from '../../lib/slide-render'
import { loadLogoForStory, renderStory } from '../../lib/story-render'
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

// The branding at the foot of the story: the logo, larger than on a square
// advert because a story is twice as tall, and the web address under it.
// The preview mirrors lib/story-render.ts, which draws the real one.
function Lockup({ logoUrl, website, carded }: { logoUrl: string | null; website: string; carded: boolean }) {
  if (!logoUrl && !website) return null
  return (
    <div className={styles.lockup} data-testid="story-lockup">
      {logoUrl && <img className={carded ? styles.cardedLogo : styles.logo} src={logoUrl} alt="" />}
      {website && <span className={styles.website}>{website}</span>}
    </div>
  )
}

// An Instagram Story: the photo with its words and branding drawn over it,
// clear of the areas Instagram covers with its own controls. The finished
// image is drawn here in the browser when it is downloaded.
export default function StoryTile({ image, words, onRegenerate, disabled }: StoryTileProps) {
  const { profile } = useProfile()
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  // A dark logo needs a white card behind it; a light one sits straight on
  // the darkened photo.
  const [carded, setCarded] = useState(false)
  const info = PLATFORM_INFO.story
  const colour = profile?.brandColours[0] ?? '#1d4ed8'
  const websiteUrl = profile?.websiteUrl ?? ''
  const logoUrl = profile?.logoUrl ?? null

  useEffect(() => {
    if (!logoUrl) return
    let live = true
    void loadLogoForStory(logoUrl).then((needed) => {
      if (live) setCarded(needed)
    })
    return () => {
      live = false
    }
  }, [logoUrl])

  async function download() {
    setSaving(true)
    setFailed(false)
    try {
      const blob = await renderStory({ photo: image.url, logo: logoUrl, colour, websiteUrl }, words)
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
        <div className={styles.stack}>
          <p className={styles.headline}>{words.headline}</p>
          <p className={styles.cta} style={{ backgroundColor: colour }}>
            {words.cta}
          </p>
          <Lockup logoUrl={logoUrl} website={websiteLabel(websiteUrl)} carded={carded} />
        </div>
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
