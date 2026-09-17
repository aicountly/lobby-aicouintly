/**
 * On-screen movement controls.
 *
 * Required for touch, where there is no keyboard and a swipe is already spoken
 * for by looking around. They stay on for pointer and keyboard users too: they
 * are a working alternative for anyone who cannot hold WASD, which is a better
 * reason to keep them than screen width is to hide them.
 *
 * Each control is a hold, so it has to release on every way a hold can end —
 * pointer up, pointer cancel, lost capture, key up, and the button leaving the
 * page. A control that keeps walking after the finger lifts is the bug this
 * component exists to avoid.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import type { MoveDirection, NavigationController } from '../navigation/controller'

interface HoldProps {
  direction: MoveDirection
  controller: NavigationController
  label: string
  children: ReactNode
  className?: string
}

function HoldButton({ direction, controller, label, children, className }: HoldProps) {
  const held = useRef(false)

  const press = useCallback(() => {
    if (held.current) return
    held.current = true
    controller.setButton(direction, true)
  }, [controller, direction])

  const release = useCallback(() => {
    if (!held.current) return
    held.current = false
    controller.setButton(direction, false)
  }, [controller, direction])

  // Unmounting mid-hold must not leave the visitor walking.
  useEffect(() => release, [release])

  return (
    <button
      type="button"
      className={`lobby-pad-button${className ? ` ${className}` : ''}`}
      aria-label={label}
      data-lobby-ui
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        press()
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          press()
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') release()
      }}
      onBlur={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </button>
  )
}

export function MoveControls({ controller }: { controller: NavigationController }) {
  return (
    <div className="lobby-pad" data-lobby-ui aria-label="Movement controls" role="group">
      <div className="lobby-pad-row">
        <HoldButton direction="turnLeft" controller={controller} label="Turn left">
          ⟲
        </HoldButton>
        <HoldButton direction="forward" controller={controller} label="Walk forwards">
          ▲
        </HoldButton>
        <HoldButton direction="turnRight" controller={controller} label="Turn right">
          ⟳
        </HoldButton>
      </div>
      <div className="lobby-pad-row">
        <HoldButton direction="left" controller={controller} label="Step left">
          ◀
        </HoldButton>
        <HoldButton direction="back" controller={controller} label="Walk backwards">
          ▼
        </HoldButton>
        <HoldButton direction="right" controller={controller} label="Step right">
          ▶
        </HoldButton>
      </div>
    </div>
  )
}
