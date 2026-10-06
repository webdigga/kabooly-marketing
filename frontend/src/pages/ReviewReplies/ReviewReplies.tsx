import { Check, Copy, MessageSquare, Star } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Alert from '../../components/Alert/Alert'
import Button from '../../components/Button/Button'
import { buttonClass } from '../../components/Button/buttonClass'
import Card from '../../components/Card/Card'
import { TextArea } from '../../components/Field/Field'
import LoadError from '../../components/LoadError/LoadError'
import PageLoader from '../../components/PageLoader/PageLoader'
import { ApiError, api } from '../../lib/api'
import { limitMessage } from '../../lib/limits'
import styles from './ReviewReplies.module.css'

interface Review {
  id: string
  author: string
  rating: number
  comment: string | null
  at: string
  reply: string | null
}

const BLOCKED: Record<string, string> = {
  not_connected: 'Connect Google Business Profile in Settings and your reviews appear here.',
  no_location: 'That Google account does not manage a business listing. Connect the account that owns yours.',
}

const STARS = 5

function Stars({ rating }: { rating: number }) {
  return (
    <span className={styles.stars} aria-label={`${rating} out of 5`}>
      {Array.from({ length: STARS }, (_, i) => (
        <Star key={i} size={15} aria-hidden="true" className={i < rating ? styles.on : styles.off} />
      ))}
    </span>
  )
}

function when(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ReviewCard({ review }: { review: Review }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function write() {
    setWriting(true)
    setProblem(null)
    try {
      const body = await api<{ reply: string }>('/api/reviews/reply', {
        method: 'POST',
        body: { author: review.author, rating: review.rating, comment: review.comment },
      })
      setDraft(body.reply)
    } catch (err) {
      setProblem(limitMessage(err) ?? (err instanceof ApiError ? err.message : 'That reply could not be written. Try again.'))
    } finally {
      setWriting(false)
    }
  }

  async function copy() {
    if (!draft) return
    try {
      await navigator.clipboard.writeText(draft)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <li className={styles.review} data-testid={`review-${review.id}`}>
      <div className={styles.head}>
        <div>
          <p className={styles.author}>{review.author}</p>
          <Stars rating={review.rating} />
        </div>
        <p className={styles.date}>{when(review.at)}</p>
      </div>
      {review.comment ? <p className={styles.comment}>{review.comment}</p> : <p className={styles.quiet}>A rating with no words.</p>}

      {review.reply ? (
        <div className={styles.replied}>
          <p className={styles.repliedLabel}>You replied</p>
          <p className={styles.comment}>{review.reply}</p>
        </div>
      ) : draft === null ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            icon={<MessageSquare size={16} aria-hidden="true" />}
            loading={writing}
            onClick={() => void write()}
            data-testid={`draft-${review.id}`}
          >
            Draft a reply
          </Button>
          {problem && <Alert tone="warning">{problem}</Alert>}
        </div>
      ) : (
        <div className={styles.draft}>
          <TextArea
            label="Your reply"
            value={draft}
            rows={4}
            maxLength={400}
            onChange={(e) => {
              setDraft(e.target.value)
              setCopied(false)
            }}
            data-testid={`reply-${review.id}`}
          />
          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              icon={copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              onClick={() => void copy()}
              data-testid={`copy-${review.id}`}
            >
              {copied ? 'Copied' : 'Copy the reply'}
            </Button>
            <Button variant="ghost" size="sm" loading={writing} onClick={() => void write()} data-testid={`rewrite-${review.id}`}>
              Write another
            </Button>
          </div>
          <p className={styles.quiet}>Paste it into Google under the review. Nothing is posted for you.</p>
        </div>
      )}
    </li>
  )
}

export default function ReviewReplies() {
  const [reviews, setReviews] = useState<Review[] | null>(null)
  const [place, setPlace] = useState('')
  const [blocked, setBlocked] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async () => {
    setStatus('loading')
    setBlocked(null)
    try {
      const body = await api<{ place: string; reviews: Review[] }>('/api/reviews')
      setReviews(body.reviews)
      setPlace(body.place)
      setStatus('ready')
    } catch (err) {
      const reason = err instanceof ApiError ? BLOCKED[err.code ?? ''] : undefined
      if (reason) {
        setBlocked(reason)
        setStatus('ready')
        return
      }
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const waiting = (reviews ?? []).filter((r) => !r.reply).length

  return (
    <div className={styles.page}>
      <div>
        <h1>Your reviews</h1>
        <p className={styles.lead}>
          Google counts replies, and people read them. Draft one here, then paste it into Google under the review.
        </p>
      </div>

      {status === 'loading' && <PageLoader label="Reading your Google reviews..." />}
      {status === 'error' && <LoadError message="Your reviews could not be loaded." onRetry={() => void load()} />}

      {blocked && (
        <Card title="Nothing to show yet" testId="reviews-blocked">
          <Alert tone="info">{blocked}</Alert>
          <Link to="/settings" className={buttonClass({ variant: 'secondary' })}>
            Go to Settings
          </Link>
        </Card>
      )}

      {reviews && !blocked && (
        <Card
          title={place || 'Your business'}
          description={waiting === 1 ? '1 review is waiting for a reply.' : `${waiting} reviews are waiting for a reply.`}
          testId="reviews-list"
        >
          {reviews.length > 0 ? (
            <ul className={styles.list} role="list">
              {reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </ul>
          ) : (
            <p className={styles.quiet}>No reviews yet. Ask for your first one.</p>
          )}
        </Card>
      )}
    </div>
  )
}
