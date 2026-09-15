import { AlertCircle, CheckCircle2, Clock, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './Alert.module.css'

type Tone = 'error' | 'success' | 'info' | 'warning'

const ICONS = { error: AlertCircle, success: CheckCircle2, info: Info, warning: Clock }

interface AlertProps {
  tone: Tone
  children: ReactNode
  testId?: string
}

export default function Alert({ tone, children, testId }: AlertProps) {
  const Icon = ICONS[tone]
  return (
    <div
      className={`${styles.alert} ${styles[tone]}`}
      role={tone === 'error' ? 'alert' : 'status'}
      data-testid={testId}
    >
      <Icon size={18} className={styles.icon} aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}
