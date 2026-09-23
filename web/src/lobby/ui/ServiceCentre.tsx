/**
 * The reception service interface.
 *
 * One component, two presentations: it is the body of the modal that opens when
 * a visitor selects the desk in 3D, and it is rendered inline in Standard View.
 * Sharing it is what guarantees the requirement that both routes offer exactly
 * the same choices — they cannot drift apart, because there is only one of them.
 */
import { useEffect, useRef, useState } from 'react'

import type { CharacterCapability } from '../reception/capability'
import type { ConversationSnapshot, ReceptionConversation } from '../reception/conversation'
import type { ReceptionMode } from '../reception/useReception'
import type { LobbyCapabilities } from '../services/receptionApi'
import { describeIntegrations } from '../services/registry'
import type { LobbyServiceAdapter } from '../services/types'
import { BookingJourney } from './journeys/BookingJourney'
import { EnquiryJourney } from './journeys/EnquiryJourney'
import { HandoverJourney } from './journeys/HandoverJourney'
import { ReceptionChat } from './ReceptionChat'
import { DemoBanner } from './Notices'

export type ServiceKey = 'booking' | 'enquiry' | 'team' | 'handover'

export interface ReceptionBinding {
  conversation: ReceptionConversation
  snapshot: ConversationSnapshot
  capability: CharacterCapability
  mode: ReceptionMode
  capabilities: LobbyCapabilities | null
}

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
  {
    key: 'handover',
    title: 'Speak to a person',
    blurb: 'Join the queue for a member of staff.',
  },
]

/**
 * Which journeys this business actually offers.
 *
 * Read from the capability report rather than shown unconditionally. A tile
 * that opens a panel saying the thing it offered is unavailable is worse than
 * no tile — and in demonstration mode every one is shown, because the point
 * there is to demonstrate them.
 */
function offered(services: typeof SERVICES, reception: ReceptionBinding, mode: string) {
  if (mode !== 'live') return services

  const journeys = reception.capabilities?.journeys
  if (!journeys) return services

  return services.filter((service) =>
    service.key === 'booking'
      ? journeys.booking
      : service.key === 'handover'
        ? journeys.handover
        : true,
  )
}

interface Props {
  adapter: LobbyServiceAdapter
  /** Shown as a headline above the choices. */
  heading?: string
  /**
   * The live conversation. Shared with the 3D character rather than owned here,
   * so the figure behind the counter and this panel are always the same
   * exchange — opening the panel from 3D does not start a second one.
   */
  reception: ReceptionBinding
  /** Open straight onto a journey, e.g. when Talk is pressed in the 3D view. */
  initialService?: ServiceKey | null
}

export function ServiceCentre({
  adapter,
  heading = 'How can we help?',
  reception,
  initialService = null,
}: Props) {
  const [active, setActive] = useState<ServiceKey | null>(initialService)
  const visible = offered(SERVICES, reception, adapter.mode)
  const current = SERVICES.find((service) => service.key === active)
  const root = useRef<HTMLDivElement>(null)

  // Changing journey swaps the whole body but not the scroll position, so the
  // panel can open part-way down its own opening paragraph. Whatever moved it —
  // focus, a restored position — the first thing a new journey should show is
  // its top.
  useEffect(() => {
    let node = root.current?.parentElement
    while (node) {
      if (node.scrollHeight > node.clientHeight) {
        node.scrollTop = 0
        return
      }
      node = node.parentElement
    }
  }, [active])

  return (
    <div className="lobby-service-centre" ref={root}>
      <DemoBanner mode={adapter.mode} />

      {current ? (
        <>
          <button type="button" className="lobby-back" onClick={() => setActive(null)}>
            ← All services
          </button>
          <h3 className="lobby-service-title">{current.title}</h3>
          {active === 'booking' ? (
            <BookingJourney adapter={adapter} onReceipt={reception.conversation.announceReceipt} />
          ) : null}
          {active === 'enquiry' ? (
            <EnquiryJourney adapter={adapter} onReceipt={reception.conversation.announceReceipt} />
          ) : null}
          {active === 'handover' ? <HandoverJourney adapter={adapter} /> : null}
          {active === 'team' ? (
            <ReceptionChat
              conversation={reception.conversation}
              snapshot={reception.snapshot}
              capability={reception.capability}
              mode={reception.mode}
              capabilities={reception.capabilities}
              onOpenService={setActive}
            />
          ) : null}
        </>
      ) : (
        <>
          <h3 className="lobby-service-title">{heading}</h3>
          <ul className="lobby-service-list">
            {visible.map((service) => (
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
