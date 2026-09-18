import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Alert from '../Alert/Alert'
import Button from '../Button/Button'
import styles from './ConfirmDialog.module.css'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  // Shown while the action runs, and again if it fails.
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

// One way of asking "are you sure": a modal over the page, with the risky
// button last, Escape to back out and the focus moved into the dialog.
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    dialog.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open, busy, onCancel])

  if (!open) return null
  return createPortal(
    <div className={styles.backdrop} onClick={() => !busy && onCancel()} data-testid="dialog-backdrop">
      <div
        ref={dialog}
        tabIndex={-1}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
        data-testid="confirm-dialog"
      >
        <h2 id="confirm-title" className={styles.title}>
          {title}
        </h2>
        <p className={styles.message}>{message}</p>
        {error && <Alert tone="error">{error}</Alert>}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onCancel} disabled={busy} data-testid="cancel-confirm">
            Cancel
          </Button>
          <Button variant="danger" className={styles.destructive} loading={busy} onClick={onConfirm} data-testid="confirm-action">
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
