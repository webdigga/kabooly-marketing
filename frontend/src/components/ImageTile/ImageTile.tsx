import { Download, RefreshCw } from 'lucide-react'
import { PLATFORM_INFO } from '../../lib/platforms'
import type { AdvertImage, Platform } from '../../lib/types'
import Button from '../Button/Button'
import { buttonClass } from '../Button/buttonClass'
import styles from './ImageTile.module.css'

export type TileStatus = 'pending' | 'ready' | 'error' | 'regenerating'

interface ImageTileProps {
  platform: Platform
  image?: AdvertImage
  status: TileStatus
  error?: string
  // Omitted in the library, where images are download-only.
  onRegenerate?: () => void
  disabled?: boolean
}

function Overlay({ status, error, hasImage }: { status: TileStatus; error?: string; hasImage: boolean }) {
  if (status === 'pending' || status === 'regenerating') {
    return (
      <div className={styles.overlay} role="status">
        <span className={styles.spinner} aria-hidden="true" />
        <span>{status === 'pending' ? 'Making your image' : 'Making a new image'}</span>
      </div>
    )
  }
  if (status === 'error' && !hasImage) {
    return (
      <div className={styles.overlay} role="alert">
        <span>{error ?? 'This image could not be made.'}</span>
      </div>
    )
  }
  return null
}

export default function ImageTile({ platform, image, status, error, onRegenerate, disabled }: ImageTileProps) {
  const info = PLATFORM_INFO[platform]
  const busy = status === 'pending' || status === 'regenerating'
  return (
    <figure className={styles.tile} data-testid={`image-${platform}`}>
      <figcaption className={styles.caption}>
        <span className={styles.platform}>{info.label}</span>
        <span className={styles.size}>
          {info.width} × {info.height}
        </span>
      </figcaption>
      <div className={styles.frame} style={{ aspectRatio: `${info.width} / ${info.height}` }}>
        {image && <img src={image.url} alt={`${info.label} image`} className={busy ? styles.dim : undefined} />}
        <Overlay status={status} error={error} hasImage={Boolean(image)} />
      </div>
      {status === 'error' && image && <p className={styles.error}>{error}</p>}
      {!busy && (
        <div className={styles.actions}>
          {image && (
            <a href={image.downloadUrl} download className={buttonClass({ variant: 'primary', size: 'sm' })}>
              <Download size={16} aria-hidden="true" />
              Download
            </a>
          )}
          {onRegenerate && (
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={16} aria-hidden="true" />}
              onClick={onRegenerate}
              disabled={disabled}
              data-testid={`regenerate-${platform}`}
            >
              {image ? 'Regenerate' : 'Try again'}
            </Button>
          )}
        </div>
      )}
    </figure>
  )
}
