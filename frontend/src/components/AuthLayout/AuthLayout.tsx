import type { ReactNode } from 'react'
import Logo from '../Logo/Logo'
import styles from './AuthLayout.module.css'

interface AuthLayoutProps {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}

export default function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <main className={styles.page}>
      <div className={styles.brand}>
        <Logo size={32} />
        <span>
          Kabooly <span className={styles.brandTag}>Marketing</span>
        </span>
      </div>
      <div className={styles.card}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {children}
      </div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </main>
  )
}
