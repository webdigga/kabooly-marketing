import Alert from '../Alert/Alert'
import Button from '../Button/Button'
import styles from './LoadError.module.css'

export default function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.wrap}>
      <Alert tone="error">{message}</Alert>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  )
}
