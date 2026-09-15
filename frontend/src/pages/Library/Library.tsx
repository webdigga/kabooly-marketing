import { Images } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ReadOnlyAdvertText } from '../../components/AdvertText/AdvertText'
import Alert from '../../components/Alert/Alert'
import Button from '../../components/Button/Button'
import { buttonClass } from '../../components/Button/buttonClass'
import Card from '../../components/Card/Card'
import ImageTile from '../../components/ImageTile/ImageTile'
import LoadError from '../../components/LoadError/LoadError'
import PageLoader from '../../components/PageLoader/PageLoader'
import { api } from '../../lib/api'
import type { Advert } from '../../lib/types'
import styles from './Library.module.css'

interface Page {
  adverts: Advert[]
  nextCursor: string | null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function AdvertEntry({ advert }: { advert: Advert }) {
  return (
    <Card title={advert.topic} description={formatDate(advert.createdAt)} testId="library-post">
      <ReadOnlyAdvertText body={advert.body} />
      {advert.images.length > 0 && (
        <div className={styles.images}>
          {advert.images.map((image) => (
            <ImageTile key={image.platform} platform={image.platform} image={image} status="ready" />
          ))}
        </div>
      )}
    </Card>
  )
}

export default function Library() {
  const [adverts, setAdverts] = useState<Advert[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState(false)

  const loadFirst = useCallback(async () => {
    setStatus('loading')
    try {
      const page = await api<Page>('/api/posts')
      setAdverts(page.adverts)
      setCursor(page.nextCursor)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFirst()
  }, [loadFirst])

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    setMoreError(false)
    try {
      const page = await api<Page>(`/api/posts?before=${encodeURIComponent(cursor)}`)
      setAdverts((list) => [...list, ...page.adverts])
      setCursor(page.nextCursor)
    } catch {
      setMoreError(true)
    } finally {
      setLoadingMore(false)
    }
  }

  if (status === 'loading') return <PageLoader label="Loading your adverts" />
  if (status === 'error') return <LoadError message="Could not load your adverts." onRetry={() => void loadFirst()} />

  return (
    <div className={styles.page}>
      <div>
        <h1>Library</h1>
        <p className={styles.lead}>Every advert you have made, newest first.</p>
      </div>
      {adverts.length === 0 ? (
        <Card>
          <div className={styles.empty}>
            <Images size={48} aria-hidden="true" />
            <h2>No adverts yet</h2>
            <p>Adverts appear here as soon as you create them.</p>
            <Link to="/" className={buttonClass()}>
              Create your first advert
            </Link>
          </div>
        </Card>
      ) : (
        adverts.map((advert) => <AdvertEntry key={advert.id} advert={advert} />)
      )}
      {moreError && <Alert tone="error">Could not load more adverts. Try again.</Alert>}
      {cursor && (
        <div className={styles.more}>
          <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()} data-testid="load-more">
            Show older adverts
          </Button>
        </div>
      )}
    </div>
  )
}
