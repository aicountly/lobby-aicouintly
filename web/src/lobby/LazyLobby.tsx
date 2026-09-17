/**
 * The lobby, loaded on demand.
 *
 * three.js is about a megabyte before compression, and the sign-in screen has
 * no use for it. Splitting the import here keeps the auth path as light as it
 * was before the lobby existed: the 3D chunk is fetched only once a surface
 * that actually renders the room is on screen.
 */
import { lazy, Suspense } from 'react'
import type { ComponentProps } from 'react'

import type { LobbyExperience as LobbyExperienceType } from './LobbyExperience'

const LobbyExperience = lazy(async () => {
  const module = await import('./LobbyExperience')
  return { default: module.LobbyExperience }
})

type Props = ComponentProps<typeof LobbyExperienceType>

/**
 * Styled inline rather than from lobby.css, which arrives with the chunk this
 * is waiting for.
 */
function Preparing() {
  return (
    <main
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f6f1e8',
        color: '#5c666e',
        font: "400 0.95rem/1.6 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <p>Preparing the lobby…</p>
    </main>
  )
}

export function LazyLobby(props: Props) {
  return (
    <Suspense fallback={<Preparing />}>
      <LobbyExperience {...props} />
    </Suspense>
  )
}
