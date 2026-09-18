import { Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatDate } from '../../lib/format'
import { PLATFORM_INFO } from '../../lib/platforms'
import type { Advert } from '../../lib/types'
import styles from './LibraryCard.module.css'

// A square image reads best as a thumbnail, so Instagram or Nextdoor first,
// then a carousel's background or a video's first frame.
function thumbnailOf(advert: Advert): string | undefined {
  const order = ['instagram', 'nextdoor', 'facebook']
  const image = [...advert.images].sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform))[0]
  return image?.url ?? advert.background?.url ?? advert.video?.start.url
}

function kindsOf(advert: Advert): string[] {
  const kinds = advert.images.map((i) => PLATFORM_INFO[i.platform].label)
  if (advert.format === 'carousel') kinds.push('Carousel')
  if (advert.video?.status === 'ready') kinds.push('Video')
  return kinds
}

interface LibraryCardProps {
  advert: Advert
  selected: boolean
  onSelect: (id: string, selected: boolean) => void
}

// One advert in the library grid: a thumbnail, the topic and the date.
// The whole card opens the advert; the tick box picks it for deleting.
export default function LibraryCard({ advert, selected, onSelect }: LibraryCardProps) {
  const thumbnail = thumbnailOf(advert)
  const kinds = kindsOf(advert)
  return (
    <div className={[styles.wrap, selected && styles.selectedWrap].filter(Boolean).join(' ')}>
      <label className={styles.pick}>
        <input
          type="checkbox"
          className="visually-hidden"
          checked={selected}
          onChange={(e) => onSelect(advert.id, e.target.checked)}
          data-testid={`select-${advert.id}`}
        />
        <span className={styles.box} aria-hidden="true">
          {selected && <Check size={14} />}
        </span>
        <span className="visually-hidden">Select this advert</span>
      </label>
      <Link to={`/library/${advert.id}`} className={styles.card} data-testid="library-card">
        <div className={styles.thumb}>
          {thumbnail ? (
            <img src={thumbnail} alt="" loading="lazy" />
          ) : (
            <p className={styles.excerpt}>{advert.body}</p>
          )}
        </div>
        <div className={styles.meta}>
          <span className={styles.topic}>{advert.topic}</span>
          <span className={styles.details}>
            {formatDate(advert.createdAt)}
            {kinds.length > 0 && ` · ${kinds.join(', ')}`}
          </span>
        </div>
      </Link>
    </div>
  )
}
