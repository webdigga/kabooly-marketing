import { usageRows } from '../../lib/limits'
import type { Usage } from '../../lib/types'
import styles from './UsagePanel.module.css'

// A read-only stats strip: what the account has left, each with a bar that
// fills as the allowance is used and turns amber when little is left.
export default function UsagePanel({ usage }: { usage: Usage | null }) {
  if (!usage) return null
  return (
    <section className={styles.strip} aria-label="Your allowance" data-testid="usage">
      {usageRows(usage).map((row) => (
        <div key={row.label} className={row.low ? `${styles.stat} ${styles.low}` : styles.stat}>
          <p className={styles.figure}>
            <span className={styles.number}>{row.left}</span> left
          </p>
          <p className={styles.label}>
            {row.label} <span className={styles.of}>of {row.limit}</span>
          </p>
          <div
            className={styles.track}
            role="meter"
            aria-label={`${row.label} used`}
            aria-valuemin={0}
            aria-valuemax={row.limit}
            aria-valuenow={row.limit - row.left}
          >
            <span className={styles.fill} style={{ width: `${row.usedShare * 100}%` }} />
          </div>
          {row.freeAt && <p className={styles.freeAt}>{row.freeAt}</p>}
        </div>
      ))}
    </section>
  )
}
