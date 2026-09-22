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
import { APPOINTMENTS_API_BASE_URL } from '../lobbyConfig'
import { createReceptionApi } from './receptionApi'
import type { ReceptionApi } from './receptionApi'
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

/**
 * One API client for the lifetime of the module.
 *
 * It holds the visitor session, so a new one per call would mint a session per
 * message and spend the visitor's own rate limit on bookkeeping.
 */
let receptionApi: ReceptionApi | null = null

function api(): ReceptionApi {
  return (receptionApi ??= createReceptionApi())
}

/** Exposed so the experience can hand the same client to speech and transcription. */
export function liveReceptionApi(): ReceptionApi {
  return api()
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
    const result = await api().ask(question, history)

    if (!result.ok) {
      // Every failure path lands here and says so. There is deliberately no
      // branch that answers from the demonstration script: a live deployment
      // that quietly fell back to keyword matching would be presenting a
      // demonstration to a visitor as a real model.
      return unavailable(RECEPTION_AI, result.reason)
    }

    const text = result.data.reply.trim()
    if (!text) {
      return unavailable(RECEPTION_AI, 'Reception answered with nothing.')
    }

    return {
      status: 'ok',
      mode: 'live',
      data: {
        text,
        demo: false,
        suggestions: result.data.suggestions,
        actions: result.data.actions,
      },
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
  // Whatever the last capability fetch found. Null before the first one, which
  // renders as "not connected" — the safe reading while it is still unknown.
  const report = api().lastCapabilities()

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
      // Read from the deployment rather than from a build-time flag: whether a
      // model answers is a server fact, and the server is the only thing that
      // knows it.
      connected: report?.conversation.configured ?? false,
      detail:
        report?.conversation.configured === true
          ? 'Answering through this product’s own API. The model credential is server-side only.'
          : (report?.conversation.reason ??
            'Not connected. The model credential is server-side only; set LOBBY_AI_API_KEY and LOBBY_SESSION_SECRET in the API .env.'),
    },
    {
      name: 'Approved business knowledge',
      owner: 'Aicountly Lobby',
      connected: report?.knowledge.configured ?? false,
      detail:
        report?.knowledge.configured === true
          ? `Loaded on the server: ${report.knowledge.sections.join(', ')}.`
          : 'No approved information configured, so reception can only say what it does not know.',
    },
    {
      name: 'Spoken replies',
      owner: 'Aicountly Lobby',
      connected: report?.speech.configured ?? false,
      detail:
        report?.speech.configured === true
          ? 'Synthesised on the server and played in the browser.'
          : 'No server voice configured. The browser’s own speech engine is used where it has one.',
    },
    {
      name: 'Voice transcription',
      owner: 'Aicountly Lobby',
      connected: report?.transcription.configured ?? false,
      detail:
        report?.transcription.configured === true
          ? 'Recordings are transcribed on the server and never stored.'
          : 'No server transcription configured. The browser’s own recogniser is used where it has one.',
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
