import { Link2Off, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import Alert from '../Alert/Alert'
import Button from '../Button/Button'
import { buttonClass } from '../Button/buttonClass'
import Card from '../Card/Card'
import styles from './GoogleConnections.module.css'

type Service = 'search_console' | 'business_profile'

interface Connection {
  service: Service
  account: string
  connectedAt: string
}

interface Offer {
  service: Service
  title: string
  description: string
  connectLabel: string
  hint: string
}

// Two separate connections on purpose: Search Console only asks to read
// search figures, where Business Profile has to ask for a scope that sounds
// like we could edit their listing. Nobody should have to agree to the
// second to get the first.
const OFFERS: Offer[] = [
  {
    service: 'search_console',
    title: 'Google Search Console',
    description:
      'See what people actually search for before they find you. We only read: nothing is ever posted or changed in your Google account.',
    connectLabel: 'Connect Search Console',
    hint: 'You need a Google account that already has your website in Search Console.',
  },
  {
    service: 'business_profile',
    title: 'Google Business Profile',
    description:
      'Brings your Google reviews in so replies can be drafted for you. We only read: replies are yours to paste, and nothing is posted for you.',
    connectLabel: 'Connect Business Profile',
    hint: 'Google asks for permission to manage your listing, because that is the only permission reviews come under. This app never writes to it.',
  },
]

// What the callback tells us through the address bar.
const OUTCOMES: Record<string, { tone: 'success' | 'warning' | 'error'; message: string }> = {
  connected: { tone: 'success', message: 'That Google account is connected.' },
  refused: { tone: 'warning', message: 'Nothing was connected. You can try again whenever you like.' },
  expired: { tone: 'warning', message: 'That took too long, so nothing was connected. Try again.' },
  failed: { tone: 'error', message: 'Google could not be connected. Try again.' },
}

// The customer's own Google connections. Read-only access, and the tool
// never posts anything to Google: it only reads their numbers in.
// The testid suffix each service answers to, which is also the path the
// connect link and the disconnect call use.
function slug(service: Service): string {
  return service.replace('_', '-')
}

interface OneProps {
  offer: Offer
  connection: Connection | undefined
  loading: boolean
  onDisconnect: (service: Service) => Promise<void>
}

function OneConnection({ offer, connection, loading, onDisconnect }: OneProps) {
  const [removing, setRemoving] = useState(false)
  const name = slug(offer.service)

  async function disconnect() {
    setRemoving(true)
    try {
      await onDisconnect(offer.service)
    } finally {
      setRemoving(false)
    }
  }

  if (loading) {
    return (
      <p className={styles.note} role="status">
        Checking your Google connections...
      </p>
    )
  }
  return connection ? (
    <div className={styles.row}>
      <p className={styles.account} data-testid={`${name}-account`}>
        Connected as {connection.account}
      </p>
      <Button
        variant="secondary"
        icon={<Link2Off size={18} aria-hidden="true" />}
        loading={removing}
        onClick={() => void disconnect()}
        data-testid={`disconnect-${name}`}
      >
        Disconnect
      </Button>
    </div>
  ) : (
    <div className={styles.row}>
      <a href={`/api/google/${offer.service}/connect`} className={buttonClass()} data-testid={`connect-${name}`}>
        <Search size={18} aria-hidden="true" />
        {offer.connectLabel}
      </a>
      <p className={styles.note}>{offer.hint}</p>
    </div>
  )
}

export default function GoogleConnections() {
  const [params, setParams] = useSearchParams()
  const [connections, setConnections] = useState<Connection[] | null>(null)
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

  async function disconnect(service: Service) {
    setFailed(false)
    try {
      await api(`/api/google/${service}`, { method: 'DELETE' })
      setConnections((was) => (was ?? []).filter((c) => c.service !== service))
      // The banner from the connect flow no longer describes what is there.
      setOutcomeKey('')
      if (params.has('google')) setParams({}, { replace: true })
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className={styles.cards} data-testid="google-connections">
      {outcome && <Alert tone={outcome.tone}>{outcome.message}</Alert>}
      {failed && <Alert tone="error">That could not be disconnected. Try again.</Alert>}
      {OFFERS.map((offer) => (
        <Card key={offer.service} title={offer.title} description={offer.description} testId={`google-${slug(offer.service)}`}>
          <OneConnection
            offer={offer}
            connection={connections?.find((c) => c.service === offer.service)}
            loading={connections === null}
            onDisconnect={disconnect}
          />
        </Card>
      ))}
    </div>
  )
}
