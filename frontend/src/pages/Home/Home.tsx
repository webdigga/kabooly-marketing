import { ArrowRight, Camera, Clapperboard, GalleryHorizontal, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { buttonClass } from '../../components/Button/buttonClass'
import Card from '../../components/Card/Card'
import LibraryCard from '../../components/LibraryCard/LibraryCard'
import PageHeader from '../../components/PageHeader/PageHeader'
import UsagePanel from '../../components/UsagePanel/UsagePanel'
import { useProfile } from '../../context/ProfileContext'
import { api } from '../../lib/api'
import type { Advert, Usage } from '../../lib/types'
import styles from './Home.module.css'

const RECENT = 3

interface Choice {
  to: string
  label: string
  lead: string
  icon: typeof Sparkles
}

const CHOICES: Choice[] = [
  { to: '/create', label: 'Image advert', lead: 'An image for each platform, plus the words.', icon: Sparkles },
  { to: '/create/photo', label: 'Photo post', lead: 'Your own photo, cut to size and branded.', icon: Camera },
  { to: '/create/carousel', label: 'Carousel', lead: 'Five slides people swipe through.', icon: GalleryHorizontal },
  { to: '/create/video', label: 'Video', lead: 'A short vertical video for Reels.', icon: Clapperboard },
]

// The landing page: what the account has left, what to make, and the last
// few things made.
export default function Home() {
  const { profile } = useProfile()
  const [usage, setUsage] = useState<Usage | null>(null)
  const [recent, setRecent] = useState<Advert[]>([])

  useEffect(() => {
    api<Usage>('/api/usage').then(setUsage, () => undefined)
    api<{ adverts: Advert[] }>('/api/posts').then((page) => setRecent(page.adverts.slice(0, RECENT)), () => undefined)
  }, [])

  return (
    <div className="page-stack">
      <PageHeader
        title={profile ? profile.businessName : 'Your marketing'}
        lead="Make an advert, then post it yourself. Everything you make is saved to your library."
      />
      <UsagePanel usage={usage} />

      <Card title="Make something" description="Pick what you need today.">
        <ul className={styles.choices} role="list">
          {CHOICES.map((choice) => {
            const Icon = choice.icon
            return (
              <li key={choice.to}>
                <Link to={choice.to} className={styles.choice} data-testid={`make-${choice.to.split('/').pop()}`}>
                  <Icon size={22} aria-hidden="true" />
                  <span className={styles.choiceText}>
                    <span className={styles.choiceLabel}>{choice.label}</span>
                    <span className={styles.choiceLead}>{choice.lead}</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </Card>

      {recent.length > 0 && (
        <Card title="Lately" description="The last few adverts you made." testId="recent">
          <div className={styles.recent}>
            {recent.map((item) => (
              <LibraryCard key={item.id} advert={item} />
            ))}
          </div>
          <Link to="/library" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            All of your adverts
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </Card>
      )}
    </div>
  )
}
