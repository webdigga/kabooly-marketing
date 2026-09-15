import { Shuffle, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import Alert from '../../components/Alert/Alert'
import { EditableAdvertText } from '../../components/AdvertText/AdvertText'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import { TextArea } from '../../components/Field/Field'
import ImageTile from '../../components/ImageTile/ImageTile'
import PlatformPicker from '../../components/PlatformPicker/PlatformPicker'
import { api } from '../../lib/api'
import { localTime, usageLine } from '../../lib/limits'
import { loadPlatformChoice, savePlatformChoice } from '../../lib/platform-choice'
import type { Platform, Usage } from '../../lib/types'
import styles from './Generator.module.css'
import { useGenerator } from './useGenerator'
import { useTopicSuggestion } from './useTopicSuggestion'

function UsageNote({ usage }: { usage: Usage | null }) {
  if (!usage) return null
  const out = usage.imagesUsed >= usage.imagesLimit
  return (
    <p className={out ? styles.usageOut : styles.usage} data-testid="usage">
      {out && usage.nextFreeAt
        ? `You have used all ${usage.imagesLimit} images for now. More from ${localTime(usage.nextFreeAt)}.`
        : usageLine(usage.imagesUsed, usage.imagesLimit)}
    </p>
  )
}

export default function Generator() {
  const topic = useTopicSuggestion()
  const [platforms, setPlatforms] = useState<Platform[]>(loadPlatformChoice)
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
    void generator.generate(topic.topic.trim(), platforms)
  }

  const canGenerate = topic.topic.trim().length > 0 && !generator.busy && !topic.suggesting
  const hasResult = generator.advert || generator.running

  return (
    <div className={styles.page}>
      <div>
        <h1>Create an advert</h1>
        <p className={styles.lead}>One advert: the text plus an image for each platform you tick.</p>
      </div>

      <form onSubmit={submit}>
        <Card>
          <div className={styles.topicHead}>
            <TextArea
              label="Advert topic"
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
          <PlatformPicker selected={platforms} onChange={choosePlatforms} disabled={generator.busy} />
          <div className={styles.generateRow}>
            <UsageNote usage={usage} />
            <Button
              type="submit"
              icon={<Sparkles size={18} aria-hidden="true" />}
              loading={generator.running}
              disabled={!canGenerate}
              data-testid="generate"
            >
              {generator.running ? 'Creating your advert' : 'Create advert'}
            </Button>
          </div>
        </Card>
      </form>

      {generator.error && (
        <Alert tone="error" testId="generator-error">
          {generator.error}
        </Alert>
      )}

      {hasResult && (
        <Card title="Your advert" description="Saved to your library automatically." testId="result">
          {generator.advert ? (
            <EditableAdvertText
              body={generator.advert.body}
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
          {generator.slots.length > 0 && (
            <div className={styles.images}>
              {generator.slots.map((slot) => (
                <ImageTile
                  key={slot.platform}
                  platform={slot.platform}
                  image={slot.image}
                  status={slot.status}
                  error={slot.error}
                  onRegenerate={generator.advert ? () => void generator.regenerateImage(slot.platform) : undefined}
                  disabled={generator.busy}
                />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
