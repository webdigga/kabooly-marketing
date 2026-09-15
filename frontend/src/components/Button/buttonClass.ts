import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ClassOptions {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  block?: boolean
}

// Shared so links styled as buttons (downloads) match real buttons.
export function buttonClass({ variant = 'primary', size = 'md', block = false }: ClassOptions = {}): string {
  return [styles.button, styles[variant], size === 'sm' && styles.sm, block && styles.block]
    .filter(Boolean)
    .join(' ')
}
