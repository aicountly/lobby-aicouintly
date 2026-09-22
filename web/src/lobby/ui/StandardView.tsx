/**
 * Standard View: the lobby without the lobby.
 *
 * It is offered as a choice, and it is also where a visitor lands when WebGL is
 * unavailable or the renderer fails. That dual role is deliberate — the fallback
 * is not a stripped-down apology page, it is the same three services and a
 * written description of the room, which is what makes it usable rather than
 * merely present.
 */
import type { ReactNode } from 'react'

import { WAYPOINTS } from '../layout'
import { LOBBY_DISPLAY_NAME } from '../lobbyConfig'
import type { LobbyServiceAdapter } from '../services/types'
import { ServiceCentre } from './ServiceCentre'
import type { ReceptionBinding } from './ServiceCentre'

interface Props {
  adapter: LobbyServiceAdapter
  reception: ReceptionBinding
  /** Set when 3D was not a choice: unsupported, or it failed. */
  reason: string | null
  canUse3d: boolean
  onEnter3d: () => void
  /** Host controls, rendered alongside the view switch. */
  actions?: ReactNode
}

export function StandardView({ adapter, reception, reason, canUse3d, onEnter3d, actions }: Props) {
  return (
    <div className="lobby-standard">
      <header className="lobby-standard-head">
        <p className="lobby-eyebrow">{LOBBY_DISPLAY_NAME}</p>
        <h2>Reception</h2>
        <p className="lobby-standard-lede">
          Everything the 3D lobby offers, as a page. Nothing here needs a graphics card.
        </p>
        {reason ? (
          <p className="lobby-standard-reason" role="status">
            {reason}
          </p>
        ) : null}
        <div className="lobby-hud-actions">
          {canUse3d ? (
            <button type="button" className="lobby-button" onClick={onEnter3d}>
              Enter the 3D lobby
            </button>
          ) : null}
          {actions}
        </div>
      </header>

      <section className="lobby-standard-panel">
        <ServiceCentre adapter={adapter} reception={reception} />
      </section>

      <section className="lobby-standard-panel">
        <h3 className="lobby-service-title">The room, described</h3>
        <ul className="lobby-places">
          {WAYPOINTS.map((place) => (
            <li key={place.id}>
              <strong>{place.id === 'entrance' ? 'Entrance' : place.label}</strong>
              <span>{place.description}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
