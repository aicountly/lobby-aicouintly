/**
 * The interface layered over the 3D view.
 *
 * Everything in here carries `data-lobby-ui`, which is how the navigation
 * controller tells a button press from the start of a look-drag.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { WAYPOINTS } from '../layout'
import { LOBBY_DISPLAY_NAME } from '../lobbyConfig'
import type { NavigationController, NavigationSnapshot } from '../navigation/controller'
import { MoveControls } from './MoveControls'

interface Props {
  controller: NavigationController
  onOpenServices: () => void
  onStandardView: () => void
  reducedMotion: boolean
  /** Host controls, rendered after the lobby's own. */
  actions?: ReactNode
}

export function LobbyHud({
  controller,
  onOpenServices,
  onStandardView,
  reducedMotion,
  actions,
}: Props) {
  const [snapshot, setSnapshot] = useState<NavigationSnapshot>({
    travellingTo: null,
    walking: false,
    hasFocus: false,
  })

  useEffect(() => controller.subscribe(setSnapshot), [controller])

  const destinations = WAYPOINTS.filter((w) => w.id !== 'entrance')
  const entrance = WAYPOINTS.find((w) => w.id === 'entrance')

  return (
    <>
      <div className="lobby-hud lobby-hud-top" data-lobby-ui>
        <div className="lobby-brand">
          <p className="lobby-eyebrow">{LOBBY_DISPLAY_NAME}</p>
          <p className="lobby-brand-sub">Visitor reception</p>
        </div>
        <div className="lobby-hud-actions">
          <button type="button" className="lobby-button lobby-button-primary" onClick={onOpenServices}>
            Reception services
          </button>
          <button type="button" className="lobby-button" onClick={onStandardView}>
            Standard View
          </button>
          {actions}
        </div>
      </div>

      <div className="lobby-hud lobby-hud-bottom" data-lobby-ui>
        <div className="lobby-destinations" role="group" aria-label="Go to">
          <span className="lobby-destinations-label">Go to</span>
          {destinations.map((destination) => (
            <button
              key={destination.id}
              type="button"
              className="lobby-button lobby-button-quiet"
              onClick={() => controller.travelTo(destination.id)}
            >
              {destination.label}
            </button>
          ))}
          {entrance ? (
            <button
              type="button"
              className="lobby-button lobby-button-quiet"
              onClick={() => controller.travelTo(entrance.id)}
            >
              {entrance.label}
            </button>
          ) : null}
        </div>

        <MoveControls controller={controller} />
      </div>

      <p className={`lobby-hint${snapshot.hasFocus ? ' is-dim' : ''}`} data-lobby-ui>
        <span className="lobby-hint-desktop">
          Drag to look around · W A S D or arrow keys to walk · Q and E to turn
        </span>
        <span className="lobby-hint-touch">Swipe to look around · use the pad to walk</span>
      </p>

      {/* Announces arrivals for anyone who cannot see the view change. */}
      <p className="lobby-visually-hidden" role="status" aria-live="polite">
        {snapshot.travellingTo
          ? `Walking to ${WAYPOINTS.find((w) => w.id === snapshot.travellingTo)?.label ?? ''}.`
          : ''}
      </p>

      {reducedMotion ? (
        <p className="lobby-visually-hidden">
          Reduced motion is on: destinations change the view instantly and idle animation is off.
        </p>
      ) : null}
    </>
  )
}
