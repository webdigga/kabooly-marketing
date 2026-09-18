import { Clapperboard, Download } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { AdvertVideo, Usage } from '../../lib/types'
import Alert from '../Alert/Alert'
import Button from '../Button/Button'
import { buttonClass } from '../Button/buttonClass'
import styles from './VideoPanel.module.css'
import { useVideo } from './useVideo'

export const MOTION_LABEL = 'What should the video show?'
export const MOTION_HINT = 'For example: the finished garden, or before and after. Leave blank and we will plan it.'

interface VideoPanelProps {
  advertId: string
  video: AdvertVideo | null
  onUsage?: (usage: Usage) => void
  // Starts a video straight away with this direction (the Video page).
  // Undefined means wait for the button.
  autoStart?: string
}

function Pending({ video }: { video: AdvertVideo }) {
  return (
    <div className={styles.frame}>
      <img src={video.start.url} alt="The first frame of your video" className={styles.dim} />
      <div className={styles.overlay} role="status">
        <span className={styles.spinner} aria-hidden="true" />
        <span>Making your video. This takes a few minutes. You can leave this page; it will be in your library.</span>
      </div>
    </div>
  )
}

function Ready({ video }: { video: AdvertVideo }) {
  return (
    <>
      <div className={styles.frame}>
        <video src={video.video?.url} poster={video.start.url} controls playsInline className={styles.player} data-testid="video-player" />
      </div>
      <div>
        <a href={video.video?.downloadUrl} download className={buttonClass({ variant: 'primary', size: 'sm' })}>
          <Download size={16} aria-hidden="true" />
          Download video
        </a>
      </div>
    </>
  )
}

function StartControls({ hasVideo, starting, onStart }: { hasVideo: boolean; starting: boolean; onStart: () => void }) {
  return (
    <div>
      <Button
        variant={hasVideo ? 'secondary' : 'primary'}
        size="sm"
        icon={<Clapperboard size={16} aria-hidden="true" />}
        loading={starting}
        onClick={onStart}
        data-testid="make-video"
      >
        {hasVideo ? 'Make a new video' : 'Make a video'}
      </Button>
    </div>
  )
}

// A vertical video made from an advert, for Reels, Shorts, TikTok and
// Stories: start it, watch it being made, then play and download it.
export default function VideoPanel({ advertId, video: initial, onUsage, autoStart }: VideoPanelProps) {
  const { video, starting, error, start } = useVideo(advertId, initial, onUsage)
  const started = useRef(false)

  useEffect(() => {
    if (autoStart === undefined || started.current) return
    started.current = true
    void start(autoStart)
  }, [autoStart, start])

  const pending = video?.status === 'pending'
  // Started from the create screen, which already asked for the movement.
  const waiting = autoStart !== undefined && !video
  return (
    <div className={styles.panel} data-testid="video-panel">
      <p className={styles.meta}>A 10 second vertical video with captions: a hook, two shots of your work and an end card with your name. Each one uses one of your videos for the month.</p>
      {video && pending && <Pending video={video} />}
      {video?.status === 'ready' && <Ready video={video} />}
      {video?.status === 'failed' && <Alert tone="warning">That video could not be made, so it has not counted. Try again.</Alert>}
      {error && (
        <Alert tone="error" testId="video-error">
          {error}
        </Alert>
      )}
      {!pending && !(starting && waiting) && (
        <StartControls hasVideo={Boolean(video)} starting={starting} onStart={() => void start(autoStart ?? '')} />
      )}
      {starting && waiting && (
        <p className={styles.meta} role="status">
          Preparing your video...
        </p>
      )}
    </div>
  )
}
