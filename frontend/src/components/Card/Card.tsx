import type { ReactNode } from 'react'
import styles from './Card.module.css'

interface CardProps {
  title?: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  testId?: string
}

// The one content surface: every section of every screen sits in a Card.
export default function Card({ title, description, actions, children, testId }: CardProps) {
  return (
    <section className={styles.card} data-testid={testId}>
      {(title || actions) && (
        <div className={styles.head}>
          <div>
            {title && <h2 className={styles.title}>{title}</h2>}
            {description && <p className={styles.description}>{description}</p>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      )}
      <div className={styles.body}>{children}</div>
    </section>
  )
}
