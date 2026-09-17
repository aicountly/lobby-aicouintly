/**
 * The reception service interface.
 *
 * One component, two presentations: it is the body of the modal that opens when
 * a visitor selects the desk in 3D, and it is rendered inline in Standard View.
 * Sharing it is what guarantees the requirement that both routes offer exactly
 * the same choices — they cannot drift apart, because there is only one of them.
 */
import { useState } from 'react'

import { describeIntegrations } from '../services/registry'
import type { LobbyServiceAdapter } from '../services/types'
import { BookingJourney } from './journeys/BookingJourney'
import { EnquiryJourney } from './journeys/EnquiryJourney'
import { TeamJourney } from './journeys/TeamJourney'
import { DemoBanner } from './Notices'

export type ServiceKey = 'booking' | 'enquiry' | 'team'

const SERVICES: { key: ServiceKey; title: string; blurb: string }[] = [
  {
    key: 'booking',
    title: 'Book an appointment',
    blurb: 'Choose a time with our team.',
  },
  {
    key: 'enquiry',
    title: 'Make an enquiry',
    blurb: 'Send a question and we will come back to you.',
  },
  {
    key: 'team',
    title: 'Speak to our team',
    blurb: 'Ask reception a question now.',
  },
]

interface Props {
  adapter: LobbyServiceAdapter
  /** Shown as a headline above the choices. */
  heading?: string
}

export function ServiceCentre({ adapter, heading = 'How can we help?' }: Props) {
  const [active, setActive] = useState<ServiceKey | null>(null)
  const current = SERVICES.find((service) => service.key === active)

  return (
    <div className="lobby-service-centre">
      <DemoBanner mode={adapter.mode} />

      {current ? (
        <>
          <button type="button" className="lobby-back" onClick={() => setActive(null)}>
            ← All services
          </button>
          <h3 className="lobby-service-title">{current.title}</h3>
          {active === 'booking' ? <BookingJourney adapter={adapter} /> : null}
          {active === 'enquiry' ? <EnquiryJourney adapter={adapter} /> : null}
          {active === 'team' ? <TeamJourney adapter={adapter} /> : null}
        </>
      ) : (
        <>
          <h3 className="lobby-service-title">{heading}</h3>
          <ul className="lobby-service-list">
            {SERVICES.map((service) => (
              <li key={service.key}>
                <button
                  type="button"
                  className="lobby-service-card"
                  onClick={() => setActive(service.key)}
                >
                  <span className="lobby-service-card-title">{service.title}</span>
                  <span className="lobby-service-card-blurb">{service.blurb}</span>
                </button>
              </li>
            ))}
          </ul>

          <IntegrationStatusList />
        </>
      )}
    </div>
  )
}

/**
 * What the lobby is connected to, stated plainly.
 *
 * Each Aicountly application owns its own data, so this list is also the
 * architecture: Lobby asks, it does not hold.
 */
function IntegrationStatusList() {
  const [open, setOpen] = useState(false)
  const integrations = describeIntegrations()

  return (
    <details className="lobby-integrations" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>What this lobby is connected to</summary>
      <ul>
        {integrations.map((integration) => (
          <li key={integration.name}>
            <span
              className={`lobby-status-dot${integration.connected ? ' is-connected' : ''}`}
              aria-hidden="true"
            />
            <div>
              <strong>{integration.name}</strong>
              <span className="lobby-integration-owner">Owned by {integration.owner}</span>
              <span className="lobby-integration-detail">{integration.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </details>
  )
}
