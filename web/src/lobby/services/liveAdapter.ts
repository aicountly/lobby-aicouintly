/**
 * The production integration adapter.
 *
 * This is the half that talks to other Aicountly applications, and right now
 * almost all of it reports unavailable. That is the correct behaviour, not a
 * gap left to fill in later with something plausible:
 *
 *   - Aicountly Appointments owns booking workflows and reaches Aicountly
 *     Calendar itself. Lobby has no calendar store, no mirrored appointment
 *     table and no database credentials for either. It can only ask over HTTP.
 *   - At the time of writing, Appointments has published no booking API and no
 *     response contract. Guessing a path and a payload shape here would produce
 *     an integration that fails in production the first time it is switched on,
 *     so nothing is guessed. Each capability says what is missing instead.
 *   - The reception AI runs behind this product's *own* PHP API, because the
 *     model credential is governed by Aicountly Console and must never reach a
 *     browser. Every VITE_* value is inlined into the bundle and is public, so
 *     a key can only live server-side.
 *
 * This file must never import from `demoAdapter.ts`. A production adapter that
 * can fall through to canned data is worse than one that admits it is not
 * connected.
 */
import { APPOINTMENTS_API_BASE_URL, RECEPTION_AI_PATH } from '../lobbyConfig'
import { getApiBaseUrl } from '../../config'
import type {
  AvailabilitySlot,
  BookingReceipt,
  BookingRequest,
  EnquiryReceipt,
  EnquiryRequest,
  LobbyServiceAdapter,
  ReceptionReply,
  ReceptionTurn,
  ServiceOption,
  ServiceOutcome,
  ServiceUnavailable,
} from './types'

const APPOINTMENTS = 'Aicountly Appointments'
const RECEPTION_AI = 'Lobby reception AI'

function unavailable(integration: string, reason: string): ServiceUnavailable {
  return { status: 'unavailable', integration, reason }
}

/**
 * Why a booking capability cannot run.
 *
 * Two different failures, reported as two different sentences, because they
 * need two different people to fix them.
 */
function appointmentsUnavailable(): ServiceUnavailable {
  if (!APPOINTMENTS_API_BASE_URL) {
    return unavailable(
      APPOINTMENTS,
      'Not connected. Set VITE_LOBBY_APPOINTMENTS_API_BASE_URL to the Appointments API and rebuild.',
    )
  }
  return unavailable(
    APPOINTMENTS,
    'Connected but not callable: Appointments has not published a booking API contract for Lobby to use. See docs/lobby/INTEGRATIONS.md for what is required.',
  )
}

/** The request and response shape this repository defines for its own relay. */
interface ReceptionAiResponse {
  reply?: unknown
  suggestions?: unknown
}

export const liveAdapter: LobbyServiceAdapter = {
  mode: 'live',
  description:
    'Live integrations. Each capability calls the application that owns it, and reports unavailable when that application is not connected.',

  async listServices(): Promise<ServiceOutcome<ServiceOption[]>> {
    return appointmentsUnavailable()
  },

  async listAvailability(
    _serviceId: string,
    _date: string,
  ): Promise<ServiceOutcome<AvailabilitySlot[]>> {
    // Availability is Calendar's data, surfaced through Appointments. Lobby
    // must not query Calendar directly and must not cache what it returns.
    return appointmentsUnavailable()
  },

  async requestBooking(_request: BookingRequest): Promise<ServiceOutcome<BookingReceipt>> {
    return appointmentsUnavailable()
  },

  async submitEnquiry(_request: EnquiryRequest): Promise<ServiceOutcome<EnquiryReceipt>> {
    // Enquiries are destined for Connect or Helpdesk, neither of which is wired
    // up yet. Accepting one here would mean dropping it on the floor while
    // telling the visitor it had been sent.
    return unavailable(
      'Aicountly Connect / Helpdesk',
      'Not connected. Enquiry delivery has no owner endpoint configured, so nothing would receive this message.',
    )
  },

  async askReception(
    question: string,
    history: ReceptionTurn[],
  ): Promise<ServiceOutcome<ReceptionReply>> {
    if (!RECEPTION_AI_PATH) {
      return unavailable(
        RECEPTION_AI,
        'Not connected. The reception AI answers through this product’s own API so the model credential stays server-side under Aicountly Console; set VITE_LOBBY_RECEPTION_AI_PATH once that route exists.',
      )
    }

    const url = `${getApiBaseUrl()}/${RECEPTION_AI_PATH.replace(/^\//, '')}`

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history }),
      })

      if (!response.ok) {
        return unavailable(
          RECEPTION_AI,
          `The reception AI relay answered ${response.status}. No reply is available.`,
        )
      }

      const payload = (await response.json()) as ReceptionAiResponse
      const text = typeof payload.reply === 'string' ? payload.reply.trim() : ''
      if (!text) {
        return unavailable(RECEPTION_AI, 'The reception AI relay returned no reply.')
      }

      const suggestions = Array.isArray(payload.suggestions)
        ? payload.suggestions.filter((s): s is string => typeof s === 'string').slice(0, 3)
        : []

      return { status: 'ok', mode: 'live', data: { text, demo: false, suggestions } }
    } catch {
      return unavailable(RECEPTION_AI, 'The reception AI relay could not be reached.')
    }
  },
}

export interface IntegrationStatus {
  name: string
  owner: string
  connected: boolean
  detail: string
}

/**
 * What the lobby is and is not connected to, for the interface to show plainly.
 *
 * "Connected" here means configured, never that a call has succeeded — the
 * capability methods above are the only things allowed to claim that.
 */
export function describeIntegrations(): IntegrationStatus[] {
  return [
    {
      name: 'Appointments & availability',
      owner: APPOINTMENTS,
      connected: Boolean(APPOINTMENTS_API_BASE_URL),
      detail: APPOINTMENTS_API_BASE_URL
        ? 'Base URL configured. Waiting on a published booking API contract.'
        : 'No base URL configured. Appointments owns booking and reaches Calendar itself.',
    },
    {
      name: 'Calendar records',
      owner: 'Aicountly Calendar',
      connected: false,
      detail: 'Reached only through Appointments. Lobby holds no calendar data of its own.',
    },
    {
      name: 'Reception AI',
      owner: RECEPTION_AI,
      connected: Boolean(RECEPTION_AI_PATH),
      detail: RECEPTION_AI_PATH
        ? 'Relay path configured on this product’s own API.'
        : 'No relay configured. Model credentials are governed by Aicountly Console and stay server-side.',
    },
    {
      name: 'Enquiries & messaging',
      owner: 'Aicountly Connect / Helpdesk',
      connected: false,
      detail: 'Planned. Not connected in this phase.',
    },
    {
      name: 'Payments',
      owner: 'Aicountly Pay',
      connected: false,
      detail: 'Planned. Not connected in this phase.',
    },
  ]
}
