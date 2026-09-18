import { Shuffle, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import Alert from '../../components/Alert/Alert'
import { EditableAdvertText } from '../../components/AdvertText/AdvertText'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import CarouselSlides from '../../components/CarouselSlides/CarouselSlides'
import { TextArea } from '../../components/Field/Field'
import ImageTile from '../../components/ImageTile/ImageTile'
import PhotoPicker from '../../components/PhotoPicker/PhotoPicker'
import PlatformPicker from '../../components/PlatformPicker/PlatformPicker'
import UsagePanel from '../../components/UsagePanel/UsagePanel'
import VideoPanel, { MOTION_HINT, MOTION_LABEL } from '../../components/VideoPanel/VideoPanel'
import { api } from '../../lib/api'
import { loadPlatformChoice, savePlatformChoice } from '../../lib/platform-choice'
import type { Platform, UploadedPhoto, Usage } from '../../lib/types'
import styles from './Generator.module.css'
import { useGenerator } from './useGenerator'
import { useTopicSuggestion } from './useTopicSuggestion'

export type CreateFormat = 'images' | 'photo' | 'carousel' | 'video'

const TITLES: Record<CreateFormat, string> = {
  images: 'Image advert',
  photo: 'Photo post',
  carousel: 'Carousel',
  video: 'Video',
}

const LEADS: Record<CreateFormat, string> = {
  images: 'The text plus an image for each platform you tick.',
  photo: 'Your own photo, cropped for each platform you tick with your logo added, plus the text.',
  carousel: 'Five slides at 1080 × 1350 for Instagram and Facebook, plus the text. Uses one image from your allowance.',
  video: 'A 10 second captioned video for Reels, Shorts and TikTok, plus the text for your post. It takes a few minutes to make.',
}

const BUTTONS: Record<CreateFormat, [idle: string, running: string]> = {
  images: ['Create advert', 'Creating your advert'],
  photo: ['Create post', 'Creating your post'],
  carousel: ['Create carousel', 'Creating your carousel'],
  video: ['Create video', 'Writing your advert'],
}

type Generator = ReturnType<typeof useGenerator>

function GeneratedImages({ generator }: { generator: Generator }) {
  if (!generator.slots.length) return null
  return (
    <div className={styles.images}>
      {generator.slots.map((slot) => (
        <ImageTile
          key={slot.platform}
          platform={slot.platform}
          image={slot.image}
          status={slot.status}
          error={slot.error}
          onRegenerate={generator.advert?.format === 'images' ? () => void generator.regenerateImage(slot.platform) : undefined}
          disabled={generator.busy}
        />
      ))}
    </div>
  )
}

// What was made: the text, then the images, slides or video.
function Result({ generator, onUsage }: { generator: Generator; onUsage: (usage: Usage) => void }) {
  const { advert } = generator
  return (
    <Card title="Your advert" description="Saved to your library automatically." testId="result">
      {advert ? (
        <EditableAdvertText
          body={advert.body}
          onSave={generator.saveText}
          onRegenerate={() => void generator.regenerateText()}
          regenerating={generator.regeneratingText}
          disabled={generator.busy}
        />
      ) : (
        <p className={styles.writing} role="status">
          Writing your advert...
        </p>
      )}
      <GeneratedImages generator={generator} />
      {advert?.slides && generator.backgroundStatus && (
        <CarouselSlides
          slides={advert.slides}
          background={generator.background}
          backgroundStatus={generator.backgroundStatus}
          onSave={generator.saveSlides}
          onRegenerateSlides={() => void generator.regenerateSlides()}
          onRegenerateBackground={() => void generator.regenerateBackground()}
          regenerating={generator.regeneratingSlides}
          disabled={generator.busy}
        />
      )}
      {advert && generator.videoMotion !== null && (
        <VideoPanel advertId={advert.id} video={null} onUsage={onUsage} autoStart={generator.videoMotion} />
      )}
    </Card>
  )
}

interface OptionsProps {
  format: CreateFormat
  busy: boolean
  photo: UploadedPhoto | null
  onPhoto: (photo: UploadedPhoto | null) => void
  platforms: Platform[]
  onPlatforms: (platforms: Platform[]) => void
  motion: string
  onMotion: (motion: string) => void
}

// The choices that belong to the chosen format.
function FormatOptions({ format, busy, photo, onPhoto, platforms, onPlatforms, motion, onMotion }: OptionsProps) {
  return (
    <>
      {format === 'photo' && <PhotoPicker photo={photo} onChange={onPhoto} disabled={busy} />}
      {(format === 'images' || format === 'photo') && <PlatformPicker selected={platforms} onChange={onPlatforms} disabled={busy} />}
      {format === 'video' && (
        <TextArea
          label={MOTION_LABEL}
          optional
          hint={MOTION_HINT}
          value={motion}
          rows={2}
          maxLength={300}
          onChange={(e) => onMotion(e.target.value)}
          data-testid="create-motion"
        />
      )}
    </>
  )
}

export default function Generator({ format }: { format: CreateFormat }) {
  const topic = useTopicSuggestion()
  const [platforms, setPlatforms] = useState<Platform[]>(loadPlatformChoice)
  const [photo, setPhoto] = useState<UploadedPhoto | null>(null)
  const [motion, setMotion] = useState('')
  const [usage, setUsage] = useState<Usage | null>(null)
  const onUsage = useCallback((u: Usage) => setUsage(u), [])
  const generator = useGenerator(onUsage)

  useEffect(() => {
    api<Usage>('/api/usage').then(setUsage, () => undefined)
  }, [])

  function choosePlatforms(next: Platform[]) {
    setPlatforms(next)
    savePlatformChoice(next)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void generator.generate({ format, topic: topic.topic.trim(), platforms, photoKey: photo?.key, motion })
    // An uploaded photo is used up by the post made from it.
    if (format === 'photo') setPhoto(null)
  }

  const ready = format !== 'photo' || (photo !== null && platforms.length > 0)
  const canGenerate = topic.topic.trim().length > 0 && !generator.busy && !topic.suggesting && ready
  const hasResult = Boolean(generator.advert) || generator.running
  const [idleLabel, runningLabel] = BUTTONS[format]

  return (
    <div className={styles.page}>
      <div>
        <h1>{TITLES[format]}</h1>
        <p className={styles.lead}>{LEADS[format]}</p>
      </div>
      <UsagePanel usage={usage} />

      <form onSubmit={submit}>
        <Card>
          <div className={styles.topicHead}>
            <TextArea
              label="Topic"
              hint={topic.suggesting ? 'Thinking of a topic for you...' : 'Use our suggestion, change it, or type your own.'}
              value={topic.topic}
              rows={2}
              maxLength={200}
              onChange={(e) => topic.setTopic(e.target.value)}
              disabled={topic.suggesting}
              data-testid="topic-input"
            />
            <div>
              <Button
                variant="ghost"
                size="sm"
                icon={<Shuffle size={16} aria-hidden="true" />}
                loading={topic.suggesting}
                onClick={() => void topic.suggest()}
                disabled={generator.busy}
                data-testid="suggest-topic"
              >
                Suggest a different topic
              </Button>
            </div>
          </div>
          {topic.error && <Alert tone="warning">{topic.error}</Alert>}
          <FormatOptions
            format={format}
            busy={generator.busy}
            photo={photo}
            onPhoto={setPhoto}
            platforms={platforms}
            onPlatforms={choosePlatforms}
            motion={motion}
            onMotion={setMotion}
          />
          <div className={styles.generateRow}>
            <Button
              type="submit"
              icon={<Sparkles size={18} aria-hidden="true" />}
              loading={generator.running}
              disabled={!canGenerate}
              data-testid="generate"
            >
              {generator.running ? runningLabel : idleLabel}
            </Button>
          </div>
        </Card>
      </form>

      {generator.error && (
        <Alert tone="error" testId="generator-error">
          {generator.error}
        </Alert>
      )}

      {hasResult && <Result generator={generator} onUsage={onUsage} />}
    </div>
  )
}
