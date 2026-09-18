import { useEffect, useState } from 'react'
import { clock, stageAt } from '../../lib/video-progress'
import styles from './VideoPanel.module.css'

// A filled 9:16 frame with the opening image (once there is one), a moving
// bar and the elapsed time, so it is obvious a video is on its way.
export default function VideoProgress({ startUrl }: { startUrl?: string }) {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className={styles.making} data-testid="video-progress">
      <div className={styles.frame}>
        {startUrl ? (
          <img src={startUrl} alt="The first frame of your video" className={styles.dim} />
        ) : (
          <div className={styles.shimmer} aria-hidden="true" />
        )}
        <div className={styles.overlay}>
          <span className={styles.spinner} aria-hidden="true" />
          <span className={styles.elapsed}>{clock(seconds)}</span>
        </div>
      </div>
      <div className={styles.progressText}>
        <p role="status" className={styles.stage}>
          {stageAt(seconds)}...
        </p>
        <div className={styles.bar} aria-hidden="true">
          <span />
        </div>
        <p className={styles.meta}>
          A video takes a few minutes. You can leave this page and carry on; it will be waiting in your library.
        </p>
      </div>
    </div>
  )
}
