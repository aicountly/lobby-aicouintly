import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { isPublicLobbyPath } from './lobby/lobbyConfig.ts'
import PublicLobby from './pages/PublicLobby.tsx'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

/**
 * The visitor lobby is the one path that does not go through the portal.
 *
 * The decision is made here rather than inside <App> because AuthProvider jumps
 * to the portal as soon as it mounts: the public lobby has to sit outside it,
 * not inside it with the redirect disabled. Every other path — including the
 * portal's own /auth/callback landing — renders exactly what it did before.
 */
const publicLobby = isPublicLobbyPath(window.location.pathname)

createRoot(rootElement).render(
  <StrictMode>
    {publicLobby ? (
      <PublicLobby />
    ) : (
      <AuthProvider>
        <App />
      </AuthProvider>
    )}
  </StrictMode>,
)
