import { Images, Settings, Sparkles } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import Logo from '../Logo/Logo'
import styles from './AppShell.module.css'

const LINKS = [
  { to: '/', label: 'Create', icon: Sparkles, end: true },
  { to: '/library', label: 'Library', icon: Images, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
]

export default function AppShell() {
  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to="/" className={styles.brand}>
            <Logo size={28} />
            <span>
              Kabooly <span className={styles.brandTag}>Marketing</span>
            </span>
          </Link>
          <nav className={styles.nav} aria-label="Main">
            {LINKS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => [styles.link, isActive && styles.active].filter(Boolean).join(' ')}
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </>
  )
}
