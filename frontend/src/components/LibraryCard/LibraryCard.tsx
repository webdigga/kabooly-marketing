import { Link } from 'react-router-dom'
import { formatDate } from '../../lib/format'
import { PLATFORM_INFO } from '../../lib/platforms'
import type { Advert } from '../../lib/types'
import styles from './LibraryCard.module.css'

// A square image reads best as a thumbnail, so Instagram or Nextdoor first.
function thumbnailOf(advert: Advert) {
  const order = ['instagram', 'nextdoor', 'facebook']
  return [...advert.images].sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform))[0]
}

// One advert in the library grid: a thumbnail, the topic and the date.
// The whole card opens the advert.
export default function LibraryCard({ advert }: { advert: Advert }) {
  const thumbnail = thumbnailOf(advert)
  return (
    <Link to={`/library/${advert.id}`} className={styles.card} data-testid="library-card">
      <div className={styles.thumb}>
        {thumbnail ? (
          <img src={thumbnail.url} alt="" loading="lazy" />
        ) : (
          <p className={styles.excerpt}>{advert.body}</p>
        )}
      </div>
      <div className={styles.meta}>
        <span className={styles.topic}>{advert.topic}</span>
        <span className={styles.details}>
          {formatDate(advert.createdAt)}
          {advert.images.length > 0 && ` · ${advert.images.map((i) => PLATFORM_INFO[i.platform].label).join(', ')}`}
        </span>
      </div>
    </Link>
  )
}
