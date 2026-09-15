import { ArrowLeft, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ReadOnlyAdvertText } from '../../components/AdvertText/AdvertText'
import Alert from '../../components/Alert/Alert'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import ImageTile from '../../components/ImageTile/ImageTile'
import LoadError from '../../components/LoadError/LoadError'
import PageLoader from '../../components/PageLoader/PageLoader'
import { api, ApiError } from '../../lib/api'
import { formatDate } from '../../lib/format'
import type { Advert } from '../../lib/types'
import styles from './LibraryItem.module.css'

type LoadState = { status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ready'; advert: Advert }

// Delete asks once more in place before anything is removed.
function DeleteAdvert({ id }: { id: string }) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function remove() {
    setBusy(true)
    setFailed(false)
    try {
      await api(`/api/posts/${id}`, { method: 'DELETE' })
      navigate('/library', { replace: true })
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <Button variant="danger" size="sm" icon={<Trash2 size={16} aria-hidden="true" />} onClick={() => setConfirming(true)} data-testid="delete-post">
        Delete
      </Button>
    )
  }
  return (
    <div className={styles.confirm} role="group" aria-label="Confirm delete">
      <span>Delete this advert and its images? This cannot be undone.</span>
      <div className={styles.confirmButtons}>
        <Button size="sm" className={styles.deleteNow} loading={busy} onClick={() => void remove()} data-testid="confirm-delete">
          Delete
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      {failed && <Alert tone="error">The advert could not be deleted. Try again.</Alert>}
    </div>
  )
}

export default function LibraryItem() {
  const { id = '' } = useParams()
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const { advert } = await api<{ advert: Advert }>(`/api/posts/${id}`)
      setState({ status: 'ready', advert })
    } catch (err) {
      setState({ status: err instanceof ApiError && err.status === 404 ? 'missing' : 'error' })
    }
  }, [id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const back = (
    <Link to="/library" className={styles.back} data-testid="back-to-library">
      <ArrowLeft size={18} aria-hidden="true" />
      Back to library
    </Link>
  )

  if (state.status === 'loading') return <PageLoader label="Loading the advert" />
  if (state.status === 'error') return <LoadError message="Could not load this advert." onRetry={() => void load()} />
  if (state.status === 'missing') {
    return (
      <div className={styles.page}>
        {back}
        <Alert tone="info">This advert is no longer in your library.</Alert>
      </div>
    )
  }

  const { advert } = state
  return (
    <div className={styles.page}>
      {back}
      <Card title={advert.topic} description={formatDate(advert.createdAt)} actions={<DeleteAdvert id={advert.id} />} testId="library-post">
        <ReadOnlyAdvertText body={advert.body} />
        {advert.images.length > 0 && (
          <div className={styles.images}>
            {advert.images.map((image) => (
              <ImageTile key={image.platform} platform={image.platform} image={image} status="ready" />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
