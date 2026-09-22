/**
 * The modal the reception desk opens in 3D.
 *
 * It is a sibling of the scene element, never a child, so text typed in here
 * cannot reach the navigation key handler at all. Movement is suspended for as
 * long as it is open, which is belt and braces — but a visitor filling in a form
 * should never find themselves walking across the room.
 */
import { useEffect, useRef } from 'react'

import type { LobbyServiceAdapter } from '../services/types'
import { ServiceCentre } from './ServiceCentre'
import type { ReceptionBinding, ServiceKey } from './ServiceCentre'

interface Props {
  open: boolean
  adapter: LobbyServiceAdapter
  reception: ReceptionBinding
  /** Which journey to open on. The dialog unmounts when closed, so this applies
      afresh every time it opens. */
  initialService?: ServiceKey | null
  onClose: () => void
}

export function ServiceDialog({ open, adapter, reception, initialService = null, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    closeButton.current?.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      // Keep Tab inside the dialog; behind it is a 3D scene that should not be
      // reachable while a form is open.
      const focusable = panel.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="lobby-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="lobby-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Reception services"
        ref={panel}
      >
        <div className="lobby-modal-head">
          <p className="lobby-eyebrow">Reception</p>
          <button
            type="button"
            className="lobby-icon-button"
            onClick={onClose}
            ref={closeButton}
            aria-label="Close reception services"
          >
            ✕
          </button>
        </div>
        <div className="lobby-modal-body">
          <ServiceCentre adapter={adapter} reception={reception} initialService={initialService} />
        </div>
      </div>
    </div>
  )
}
