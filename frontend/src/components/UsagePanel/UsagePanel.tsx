import { usageRows } from '../../lib/limits'
import type { Usage } from '../../lib/types'
import styles from './UsagePanel.module.css'

// What the account has left: images today and this month, videos this month.
export default function UsagePanel({ usage }: { usage: Usage | null }) {
  if (!usage) return null
  return (
    <dl className={styles.panel} data-testid="usage">
      {usageRows(usage).map((row) => (
        <div key={row.label} className={row.freeAt ? styles.out : styles.row}>
          <dt className={styles.label}>{row.label}</dt>
          <dd className={styles.value}>
            {row.left}
            {row.freeAt && <span className={styles.freeAt}>{row.freeAt}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
