import { Check, Copy, Download, QrCode } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Alert from '../../components/Alert/Alert'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import { TextArea, TextInput } from '../../components/Field/Field'
import LoadError from '../../components/LoadError/LoadError'
import PageLoader from '../../components/PageLoader/PageLoader'
import { ApiError, api } from '../../lib/api'
import { drawQrCode, saveQrCode } from '../../lib/qr'
import styles from './Reviews.module.css'

interface Request {
  link: { slug: string; target: string } | null
  url: string | null
  message: string | null
}

// Long enough to read on a phone screen, small enough to copy quickly.
const COPIED_MS = 2000

function Copyable({ value, label, testId }: { value: string; label: string; testId: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), COPIED_MS)
    } catch {
      // A browser that refuses the clipboard still shows the text to select.
      setCopied(false)
    }
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      icon={copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      onClick={() => void copy()}
      data-testid={testId}
    >
      {copied ? 'Copied' : label}
    </Button>
  )
}

function QrPanel({ url, filename }: { url: string; filename: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!canvas.current) return
    drawQrCode(canvas.current, url).catch(() => setFailed(true))
  }, [url])

  return (
    <div className={styles.qr}>
      <canvas ref={canvas} className={styles.code} aria-label="QR code for your review link" role="img" data-testid="qr-code" />
      {failed && <Alert tone="warning">The QR code could not be drawn. The link above works on its own.</Alert>}
      <Button
        variant="secondary"
        size="sm"
        icon={<Download size={16} aria-hidden="true" />}
        onClick={() => saveQrCode(canvas.current, filename)}
        data-testid="download-qr"
      >
        Download the QR code
      </Button>
    </div>
  )
}

export default function Reviews() {
  const [request, setRequest] = useState<Request | null>(null)
  const [target, setTarget] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const body = await api<Request>('/api/review-request')
      setRequest(body)
      setTarget(body.link?.target ?? '')
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function save() {
    setSaving(true)
    setProblem(null)
    try {
      await api<{ link: Request['link'] }>('/api/review-link', { method: 'PUT', body: { target: target.trim() } })
      await load()
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : 'That could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.page}>
      <div>
        <h1>Ask for reviews</h1>
        <p className={styles.lead}>
          Google reviews are the strongest thing a local business has. Share one link, or print the QR code, and customers land
          straight on your review box.
        </p>
      </div>

      {status === 'loading' && <PageLoader label="Loading your review link..." />}
      {status === 'error' && <LoadError message="Your review link could not be loaded." onRetry={() => void load()} />}

      {status === 'ready' && (
        <>
          <Card
            title="Your Google review link"
            description="In Google Business Profile, open your business and use the share link under Ask for reviews. Paste it here once."
            testId="review-target"
          >
            <TextInput
              label="The link Google gave you"
              value={target}
              maxLength={500}
              placeholder="https://g.page/r/..."
              onChange={(e) => setTarget(e.target.value)}
              data-testid="review-target-input"
            />
            {problem && <Alert tone="error">{problem}</Alert>}
            <div>
              <Button loading={saving} disabled={target.trim().length === 0} onClick={() => void save()} data-testid="save-review-link">
                Save
              </Button>
            </div>
          </Card>

          {request?.url && request.message && (
            <>
              <Card title="Your short link" description="Yours for good. Changing the Google link above keeps this one working." testId="review-link">
                <p className={styles.url} data-testid="review-url">
                  {request.url}
                </p>
                <div className={styles.actions}>
                  <Copyable value={request.url} label="Copy the link" testId="copy-url" />
                </div>
              </Card>

              <Card title="The QR code" description="On a card, an invoice, a van or a receipt. People point a phone at it." testId="review-qr">
                <QrPanel url={request.url} filename="kabooly-review-qr.png" />
              </Card>

              <Card title="What to send" description="Text or email this after a job. Change it to sound like you." testId="review-message">
                <TextArea
                  label="Your message"
                  value={request.message}
                  rows={6}
                  readOnly
                  onChange={() => undefined}
                  data-testid="review-message-text"
                />
                <div className={styles.actions}>
                  <Copyable value={request.message} label="Copy the message" testId="copy-message" />
                </div>
              </Card>
            </>
          )}

          {!request?.url && (
            <Card testId="review-empty">
              <p className={styles.note}>
                <QrCode size={18} aria-hidden="true" /> Paste your Google review link above and your short link and QR code appear
                here.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
