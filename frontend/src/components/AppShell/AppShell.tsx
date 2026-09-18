import { Camera, Clapperboard, GalleryHorizontal, Images, Menu, Settings, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
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

function Item({ item, onChoose }: { item: NavItem; onChoose?: () => void }) {
  const Icon = item.icon
  return (
    <NavLink to={item.to} end={item.end} className={linkClass} onClick={onChoose}>
      <Icon size={18} aria-hidden="true" />
      {item.label}
    </NavLink>
  )
}

function Sections({ onChoose }: { onChoose?: () => void }) {
  return (
    <>
      <p className={styles.group}>Create</p>
      {CREATE.map((item) => (
        <Item key={item.to} item={item} onChoose={onChoose} />
      ))}
      <p className={styles.group}>Your account</p>
      {ACCOUNT.map((item) => (
        <Item key={item.to} item={item} onChoose={onChoose} />
      ))}
    </>
  )
}

// One navigation, shown as a sidebar on wide screens and behind a menu
// button on phones.
export default function AppShell() {
  const [open, setOpen] = useState(false)

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
          <button
            type="button"
            className={styles.menuButton}
            aria-expanded={open}
            aria-controls="main-menu"
            aria-label={open ? 'Close menu' : 'Menu'}
            onClick={() => setOpen((was) => !was)}
            data-testid="menu-button"
          >
            {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
          </button>
        </div>
        {open && (
          <nav id="main-menu" className={styles.menu} aria-label="Main">
            <Sections onChoose={() => setOpen(false)} />
          </nav>
        )}
      </header>
      <div className={styles.body}>
        <nav className={styles.sidebar} aria-label="Sections">
          <Sections />
        </nav>
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
