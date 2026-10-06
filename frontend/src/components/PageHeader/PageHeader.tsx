import type { ReactNode } from 'react'
import styles from './PageHeader.module.css'

interface PageHeaderProps {
  title: string
  lead?: string
  // The one place a page-level message appears: saved, connected, could not
  // be saved. Field-level errors stay next to their field.
  status?: ReactNode
}

// Every page opens the same way: the heading, a line of explanation, and a
// slot for whatever the page needs to tell you.
export default function PageHeader({ title, lead, status }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <h1>{title}</h1>
      {lead && <p className={styles.lead}>{lead}</p>}
      {status && (
        <div className={styles.status} aria-live="polite">
          {status}
        </div>
      )}
    </header>
  )
}
