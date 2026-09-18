import { Images, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Alert from '../../components/Alert/Alert'
import Button from '../../components/Button/Button'
import { buttonClass } from '../../components/Button/buttonClass'
import Card from '../../components/Card/Card'
import ConfirmDialog from '../../components/ConfirmDialog/ConfirmDialog'
import LibraryCard from '../../components/LibraryCard/LibraryCard'
import LoadError from '../../components/LoadError/LoadError'
import PageLoader from '../../components/PageLoader/PageLoader'
import { api } from '../../lib/api'
import type { Advert } from '../../lib/types'
import styles from './Library.module.css'

interface Page {
  adverts: Advert[]
  nextCursor: string | null
}

// The toolbar that appears as soon as something is ticked.
function SelectionBar({ count, onClear, onDelete }: { count: number; onClear: () => void; onDelete: () => void }) {
  return (
    <div className={styles.selection} data-testid="selection-bar">
      <span className={styles.count}>
        {count} {count === 1 ? 'advert' : 'adverts'} selected
      </span>
      <div className={styles.selectionActions}>
        <Button variant="secondary" size="sm" icon={<X size={16} aria-hidden="true" />} onClick={onClear} data-testid="clear-selection">
          Clear
        </Button>
        <Button variant="danger" size="sm" icon={<Trash2 size={16} aria-hidden="true" />} onClick={onDelete} data-testid="delete-selected">
          Delete
        </Button>
      </div>
    </div>
  )
}

export default function Library() {
  const [adverts, setAdverts] = useState<Advert[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [asking, setAsking] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)
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

  function pick(id: string, on: boolean) {
    setSelected((list) => (on ? [...list, id] : list.filter((s) => s !== id)))
  }

  async function deleteSelected() {
    setDeleting(true)
    setDeleteFailed(false)
    try {
      await api('/api/posts/delete', { method: 'POST', body: { ids: selected } })
      setAdverts((list) => list.filter((a) => !selected.includes(a.id)))
      setSelected([])
      setAsking(false)
    } catch {
      setDeleteFailed(true)
    } finally {
      setDeleting(false)
    }
  }

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
        <p className={styles.lead}>
          Every advert you have made, newest first. Open one to copy or download it, or tick several to delete them together.
        </p>
      </div>
      {selected.length > 0 && (
        <SelectionBar count={selected.length} onClear={() => setSelected([])} onDelete={() => setAsking(true)} />
      )}
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
        <div className={styles.grid}>
          {adverts.map((advert) => (
            <LibraryCard key={advert.id} advert={advert} selected={selected.includes(advert.id)} onSelect={pick} />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={asking}
        title={selected.length === 1 ? 'Delete this advert?' : `Delete ${String(selected.length)} adverts?`}
        message="Their images and any videos go for good. This cannot be undone."
        confirmLabel={selected.length === 1 ? 'Delete advert' : 'Delete adverts'}
        busy={deleting}
        error={deleteFailed ? 'They could not be deleted. Try again.' : null}
        onConfirm={() => void deleteSelected()}
        onCancel={() => setAsking(false)}
      />
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
