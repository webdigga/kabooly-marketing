import styles from './Divider.module.css'

export default function Divider({ label }: { label: string }) {
  return (
    <div className={styles.divider} role="separator">
      <span>{label}</span>
    </div>
  )
}
