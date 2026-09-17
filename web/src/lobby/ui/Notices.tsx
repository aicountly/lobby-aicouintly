/**
 * The small pieces of honesty that appear throughout the service panel.
 *
 * Demonstration journeys are labelled wherever they can be mistaken for the
 * real thing, and a capability that is not connected says which application
 * owns it and what is missing — never a generic error, and never a success.
 */
import type { ReactNode } from 'react'

import type { ServiceMode, ServiceUnavailable } from '../services/types'

export function DemoBanner({ mode }: { mode: ServiceMode }) {
  if (mode !== 'demo') return null
  return (
    <p className="lobby-demo-banner" role="note">
      <span className="lobby-demo-chip">Demo</span>
      Demonstration journeys. Nothing is booked, no message is sent and no member of staff is
      contacted.
    </p>
  )
}

export function UnavailableNotice({ outcome }: { outcome: ServiceUnavailable }) {
  return (
    <div className="lobby-unavailable" role="status">
      <h4>Not available</h4>
      <p>
        <strong>{outcome.integration}</strong> — {outcome.reason}
      </p>
    </div>
  )
}

export function DemoReceipt({
  reference,
  demo,
  note,
  children,
}: {
  reference: string
  demo: boolean
  note: string
  children?: ReactNode
}) {
  return (
    <div className="lobby-receipt" role="status">
      <div className="lobby-receipt-head">
        <h4>Recorded in this demonstration</h4>
        {demo ? <span className="lobby-demo-chip">Demo</span> : null}
      </div>
      {children}
      <dl className="lobby-detail-list">
        <div>
          <dt>Reference</dt>
          <dd>{reference}</dd>
        </div>
      </dl>
      <p className="lobby-receipt-note">{note}</p>
    </div>
  )
}

export function Pending({ label }: { label: string }) {
  return (
    <p className="lobby-pending" role="status">
      {label}
    </p>
  )
}
