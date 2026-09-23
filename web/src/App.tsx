import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth/AuthProvider'
import { adminScreenForPath } from './lobby/lobbyConfig'
import Dashboard from './pages/Dashboard'
import SignIn from './pages/SignIn'
import { initAnalytics, trackPageView } from './utils/analytics'
import './App.css'

initAnalytics()

/**
 * The staff surface, split out of the main bundle.
 *
 * Most people who load this app are visitors who will never see it, and the
 * public lobby is served from the same entry point. Shipping the setup forms
 * and the desk to somebody standing in a reception area is bytes spent on
 * something they cannot open.
 */
const AdminShell = lazy(() => import('./admin/AdminShell').then((m) => ({ default: m.AdminShell })))

/**
 * Login → Dashboard, plus the staff surface.
 *
 * Still no router library. The product has four extra paths and they are all
 * the same screen with a different tab selected, so a dependency to express
 * that would be more machinery than the thing it manages. The portal callback
 * lands on /auth/callback, which the SPA history fallback serves with this
 * same document, and AuthProvider consumes the token at boot.
 *
 * The staff paths sit inside <AuthProvider> like everything except the public
 * lobby, so signing in works exactly as it did. What they are allowed to show
 * is decided by the server from the caller's role, never here.
 */
export default function App() {
  const { status } = useAuth()
  const [path, setPath] = useState(() => window.location.pathname)

  // Keep up with the back button, since navigation here is pushState.
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const goHome = useCallback(() => {
    window.history.pushState({}, '', '/')
    setPath('/')
  }, [])

  const screen = adminScreenForPath(path)

  useEffect(() => {
    if (status !== 'authenticated') {
      if (status === 'signed-out') trackPageView('/sign-in', 'Sign in')
      return
    }
    if (screen) trackPageView(`/${screen}`, screen)
    else trackPageView('/dashboard', 'Dashboard')
  }, [status, screen])

  if (status === 'authenticated') {
    if (!screen) return <Dashboard />

    return (
      <Suspense
        fallback={
          <main className="screen">
            <div className="panel">
              <p className="message">Loading…</p>
            </div>
          </main>
        }
      >
        <AdminShell initialScreen={screen} onLeave={goHome} />
      </Suspense>
    )
  }

  if (status === 'signed-out') return <SignIn />

  return (
    <main className="screen">
      <div className="panel">
        <p className="message">Signing you in…</p>
      </div>
    </main>
  )
}
