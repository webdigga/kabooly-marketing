import { Camera, Clapperboard, GalleryHorizontal, Images, Settings, Sparkles } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import Logo from '../Logo/Logo'
import styles from './AppShell.module.css'

interface NavItem {
  to: string
  label: string
  icon: typeof Sparkles
  end?: boolean
}

const CREATE: NavItem[] = [
  { to: '/', label: 'Image advert', icon: Sparkles, end: true },
  { to: '/photo', label: 'Photo post', icon: Camera },
  { to: '/carousel', label: 'Carousel', icon: GalleryHorizontal },
  { to: '/video', label: 'Video', icon: Clapperboard },
]

const ACCOUNT: NavItem[] = [
  { to: '/library', label: 'Library', icon: Images },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function linkClass({ isActive }: { isActive: boolean }): string {
  return [styles.link, isActive && styles.active].filter(Boolean).join(' ')
}

function Item({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink to={item.to} end={item.end} className={linkClass}>
      <Icon size={18} aria-hidden="true" />
      {item.label}
    </NavLink>
  )
}

// One navigation, shown as a sidebar on wide screens and as a row of tabs
// under the header on phones.
export default function AppShell() {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to="/" className={styles.brand}>
            <Logo size={28} />
            <span>
              Kabooly <span className={styles.brandTag}>Marketing</span>
            </span>
          </Link>
        </div>
        <nav className={styles.tabs} aria-label="Main">
          {[...CREATE, ...ACCOUNT].map((item) => (
            <Item key={item.to} item={item} />
          ))}
        </nav>
      </header>
      <div className={styles.body}>
        <nav className={styles.sidebar} aria-label="Sections">
          <p className={styles.group}>Create</p>
          {CREATE.map((item) => (
            <Item key={item.to} item={item} />
          ))}
          <p className={styles.group}>Your account</p>
          {ACCOUNT.map((item) => (
            <Item key={item.to} item={item} />
          ))}
        </nav>
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
