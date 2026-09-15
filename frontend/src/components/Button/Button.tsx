import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './Button.module.css'
import { buttonClass } from './buttonClass'
import type { ClassOptions } from './buttonClass'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ClassOptions {
  loading?: boolean
  icon?: ReactNode
}

export default function Button({
  variant,
  size,
  block,
  loading = false,
  icon,
  children,
  disabled,
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[buttonClass({ variant, size, block }), className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : icon}
      {children}
    </button>
  )
}
