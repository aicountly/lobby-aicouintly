import { useEffect } from 'react'

import { LazyLobby } from '../lobby/LazyLobby'
import { trackPageView } from '../utils/analytics'

/**
 * The lobby as a visitor meets it: no sign-in, no portal round-trip.
 *
 * This page is deliberately outside <AuthProvider>. A reception area that
 * demands credentials before it will let you look at the room is not a
 * reception area, and there is nothing here that needs protecting — the room is
 * generated geometry and the journeys are local demonstrations. It reads no
 * business data and makes no authenticated call.
 *
 * Set VITE_LOBBY_PUBLIC_PATH to an empty string to withdraw this surface; every
 * other path keeps the existing SSO boot untouched either way.
 */
export default function PublicLobby() {
  useEffect(() => {
    trackPageView('/lobby', 'Aicountly Lobby')
  }, [])

  return <LazyLobby />
}
