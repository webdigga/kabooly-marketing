import { Link2Off, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import Alert from '../Alert/Alert'
import Button from '../Button/Button'
import { buttonClass } from '../Button/buttonClass'
import Card from '../Card/Card'
import styles from './GoogleConnections.module.css'

interface Connection {
  service: 'search_console'
  account: string
  connectedAt: string
}

// What the callback tells us through the address bar.
const OUTCOMES: Record<string, { tone: 'success' | 'warning' | 'error'; message: string }> = {
  connected: { tone: 'success', message: 'Google Search Console is connected.' },
  refused: { tone: 'warning', message: 'Nothing was connected. You can try again whenever you like.' },
  expired: { tone: 'warning', message: 'That took too long, so nothing was connected. Try again.' },
  failed: { tone: 'error', message: 'Google could not be connected. Try again.' },
}

// The customer's own Google connections. Read-only access, and the tool
// never posts anything to Google: it only reads their numbers in.
export default function GoogleConnections() {
  const [params, setParams] = useSearchParams()
  const [connections, setConnections] = useState<Connection[] | null>(null)
  const [removing, setRemoving] = useState(false)
  const [failed, setFailed] = useState(false)
  // Held in state, not read from the address bar on every render: clearing
  // the query string is a navigation, which lands a render later than the
  // connection itself and would leave the old message on screen.
  const [outcomeKey, setOutcomeKey] = useState(params.get('google') ?? '')
  const outcome = OUTCOMES[outcomeKey]

  useEffect(() => {
    api<{ connections: Connection[] }>('/api/google/connections').then(
      (body) => setConnections(body.connections),
      () => setConnections([]),
    )
  }, [])

  const searchConsole = connections?.find((c) => c.service === 'search_console')

  async function disconnect() {
    setRemoving(true)
    setFailed(false)
    try {
      await api('/api/google/search_console', { method: 'DELETE' })
      setConnections((was) => (was ?? []).filter((c) => c.service !== 'search_console'))
      // The banner from the connect flow no longer describes what is there.
      setOutcomeKey('')
      if (params.has('google')) setParams({}, { replace: true })
    } catch {
      setFailed(true)
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Card
      title="Google Search Console"
      description="See what people actually search for before they find you. We only read: nothing is ever posted or changed in your Google account."
      testId="google-connections"
    >
      {outcome && <Alert tone={outcome.tone}>{outcome.message}</Alert>}
      {failed && <Alert tone="error">That could not be disconnected. Try again.</Alert>}
      {connections === null ? (
        <p className={styles.note} role="status">
          Checking your Google connection...
        </p>
      ) : searchConsole ? (
        <div className={styles.row}>
          <p className={styles.account} data-testid="search-console-account">
            Connected as {searchConsole.account}
          </p>
          <Button
            variant="secondary"
            icon={<Link2Off size={18} aria-hidden="true" />}
            loading={removing}
            onClick={() => void disconnect()}
            data-testid="disconnect-search-console"
          >
            Disconnect
          </Button>
        </div>
      ) : (
        <div className={styles.row}>
          <a href="/api/google/search_console/connect" className={buttonClass()} data-testid="connect-search-console">
            <Search size={18} aria-hidden="true" />
            Connect Search Console
          </a>
          <p className={styles.note}>You need a Google account that already has your website in Search Console.</p>
        </div>
      )}
    </Card>
  )
}
