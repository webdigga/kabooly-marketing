import { ArrowDownRight, ArrowUpRight, Lightbulb, Minus, Search, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Alert from '../../components/Alert/Alert'
import Button from '../../components/Button/Button'
import { buttonClass } from '../../components/Button/buttonClass'
import Card from '../../components/Card/Card'
import LoadError from '../../components/LoadError/LoadError'
import PageLoader from '../../components/PageLoader/PageLoader'
import { ApiError, api } from '../../lib/api'
import { limitMessage } from '../../lib/limits'
import styles from './GetFound.module.css'

interface Totals {
  clicks: number
  impressions: number
  position: number
}

interface QueryLine {
  query: string
  clicks: number
  impressions: number
  position: number
}

interface SlippedPage {
  page: string
  position: number
  was: number
}

interface Idea {
  phrase: string
  topic: string
  why: string
}

interface Overview {
  site: string
  period: { start: string; end: string }
  totals: Totals
  before: Totals
  topQueries: QueryLine[]
  nearly: QueryLine[]
  slipped: SlippedPage[]
}

// Why there is nothing to show, in the customer's words rather than Google's.
const BLOCKED: Record<string, string> = {
  not_connected: 'Connect Google Search Console in Settings and this fills in by itself.',
  no_website: 'Add your website address in Settings first.',
  no_property: 'That Google account cannot see your website in Search Console. Connect the account that owns it.',
  no_profile: 'Finish your business profile first.',
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// Clicks and impressions go up to improve; an average position goes down.
function Change({ now, before, lowerIsBetter = false }: { now: number; before: number; lowerIsBetter?: boolean }) {
  const difference = Number((now - before).toFixed(1))
  if (difference === 0 || before === 0) return <span className={styles.flat}>no change</span>
  const better = lowerIsBetter ? difference < 0 : difference > 0
  const Icon = difference > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className={better ? styles.better : styles.worse}>
      <Icon size={14} aria-hidden="true" />
      {Math.abs(difference).toLocaleString('en-GB')} {better ? 'better' : 'worse'}
    </span>
  )
}

function Figures({ data }: { data: Overview }) {
  const stats = [
    { label: 'Visits from Google', now: data.totals.clicks, before: data.before.clicks, lowerIsBetter: false },
    { label: 'Times you appeared', now: data.totals.impressions, before: data.before.impressions, lowerIsBetter: false },
    { label: 'Average place in the results', now: data.totals.position, before: data.before.position, lowerIsBetter: true },
  ]
  return (
    <div className={styles.stats} data-testid="search-figures">
      {stats.map((stat) => (
        <div key={stat.label} className={styles.stat}>
          <p className={styles.number}>{stat.now.toLocaleString('en-GB')}</p>
          <p className={styles.statLabel}>{stat.label}</p>
          <Change now={stat.now} before={stat.before} lowerIsBetter={stat.lowerIsBetter} />
        </div>
      ))}
    </div>
  )
}

function Queries({ lines }: { lines: QueryLine[] }) {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">What they searched for</th>
            <th scope="col">Visits</th>
            <th scope="col">Seen</th>
            <th scope="col">Place</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.query}>
              <td>{line.query}</td>
              <td className={styles.figure}>{line.clicks.toLocaleString('en-GB')}</td>
              <td className={styles.figure}>{line.impressions.toLocaleString('en-GB')}</td>
              <td className={styles.figure}>{line.position}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The whole point of the page: searches worth acting on.
function Nearly({ lines }: { lines: QueryLine[] }) {
  return (
    <ul className={styles.list} role="list">
      {lines.map((line) => (
        <li key={line.query}>
          <span className={styles.phrase}>{line.query}</span>
          <span className={styles.note}>
            place {line.position}, seen {line.impressions.toLocaleString('en-GB')} times
          </span>
        </li>
      ))}
    </ul>
  )
}

// What to make next, from the business's own figures. Asked for on request
// rather than on landing, because it costs a Haiku call.
function Ideas() {
  const [ideas, setIdeas] = useState<Idea[] | null>(null)
  const [working, setWorking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function ask() {
    setWorking(true)
    setProblem(null)
    try {
      const body = await api<{ ideas: Idea[] }>('/api/search-console/ideas')
      setIdeas(body.ideas)
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined
      setProblem(
        limitMessage(err) ??
          (code === 'no_searches'
            ? 'Google has not recorded enough searches yet. Come back in a few weeks.'
            : 'The ideas could not be worked out. Try again.'),
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <Card
      title="What to make next"
      description="Four things worth making, chosen from what people actually searched for."
      testId="search-ideas"
    >
      {ideas && (
        <ul className={styles.ideas} role="list">
          {ideas.map((idea) => (
            <li key={idea.phrase} className={styles.idea}>
              <p className={styles.phrase}>{idea.phrase}</p>
              <p className={styles.note}>{idea.why}</p>
              <p className={styles.topic}>{idea.topic}</p>
              <Link
                to={`/create?topic=${encodeURIComponent(idea.topic)}`}
                className={buttonClass({ variant: 'secondary', size: 'sm' })}
                data-testid={`make-idea-${idea.phrase}`}
              >
                <Sparkles size={16} aria-hidden="true" />
                Make this advert
              </Link>
            </li>
          ))}
        </ul>
      )}
      {problem && <Alert tone="warning">{problem}</Alert>}
      <div>
        <Button
          variant={ideas ? 'ghost' : 'primary'}
          icon={<Lightbulb size={18} aria-hidden="true" />}
          loading={working}
          onClick={() => void ask()}
          data-testid="ask-ideas"
        >
          {ideas ? 'Think of some more' : 'Give me some ideas'}
        </Button>
      </div>
    </Card>
  )
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

export default function GetFound() {
  const [data, setData] = useState<Overview | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async () => {
    setStatus('loading')
    setBlocked(null)
    try {
      setData(await api<Overview>('/api/search-console/overview'))
      setStatus('ready')
    } catch (err) {
      const reason = err instanceof ApiError ? BLOCKED[err.code ?? ''] : undefined
      if (reason) {
        setBlocked(reason)
        setStatus('ready')
        return
      }
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  return (
    <div className={styles.page}>
      <div>
        <h1>Get found</h1>
        <p className={styles.lead}>What people searched for on Google before they landed on your website.</p>
      </div>

      {status === 'loading' && <PageLoader label="Reading your Search Console figures..." />}
      {status === 'error' && <LoadError message="Your search figures could not be loaded." onRetry={() => void load()} />}

      {blocked && (
        <Card title="Nothing to show yet" testId="search-blocked">
          <Alert tone="info">{blocked}</Alert>
          <Link to="/settings" className={buttonClass({ variant: 'secondary' })}>
            <Search size={18} aria-hidden="true" />
            Go to Settings
          </Link>
        </Card>
      )}

      {data && !blocked && (
        <>
          <Card
            title="The last four weeks"
            description={`${dateLabel(data.period.start)} to ${dateLabel(data.period.end)}, against the four weeks before. Google counts a day two or three days late.`}
          >
            <Figures data={data} />
          </Card>

          <Ideas />

          <Card title="Nearly there" description="You already show up for these, just too far down for anyone to find you. An advert or a page about one of these is the quickest win." testId="search-nearly">
            {data.nearly.length > 0 ? <Nearly lines={data.nearly} /> : <p className={styles.empty}>Nothing close enough to nudge yet.</p>}
          </Card>

          <Card title="What people searched for" testId="search-queries">
            {data.topQueries.length > 0 ? <Queries lines={data.topQueries} /> : <p className={styles.empty}>Google has not recorded any searches yet.</p>}
          </Card>

          {data.slipped.length > 0 && (
            <Card title="Slipping" description="These pages sat higher four weeks ago." testId="search-slipped">
              <ul className={styles.list} role="list">
                {data.slipped.map((page) => (
                  <li key={page.page}>
                    <span className={styles.phrase}>{pathOf(page.page)}</span>
                    <span className={styles.note}>
                      <Minus size={14} aria-hidden="true" />
                      place {page.was} to {page.position}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
