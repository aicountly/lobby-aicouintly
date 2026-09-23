/**
 * The production integration adapter.
 *
 * This is the half that talks to other Aicountly applications. Booking is now
 * wired to the application that owns it; enquiries and payments still report
 * unavailable, which is the correct behaviour rather than a gap to fill in
 * later with something plausible:
 *
 *   - Aicountly Appointments owns booking workflows and reaches Aicountly
 *     Calendar itself. Lobby has no calendar store, no mirrored appointment
 *     table and no database credentials for either. It can only ask over HTTP.
 *   - Booking is relayed through this product's own PHP API rather than called
 *     from here, because the call carries this product's service key for
 *     Appointments. Every VITE_* value is inlined into the bundle at build time
 *     and is public, so a key can only live server-side — which is also why
 *     `VITE_LOBBY_APPOINTMENTS_API_BASE_URL` is not what connects it.
 *   - The reception AI runs behind the same API for the same reason: the model
 *     credential is governed by Aicountly Console and must never reach a
 *     browser.
 *
 * This file must never import from `demoAdapter.ts`. A production adapter that
 * can fall through to canned data is worse than one that admits it is not
 * connected.
 */
import { createReceptionApi } from './receptionApi'
import type { ReceptionApi } from './receptionApi'
import type {
  AvailabilitySlot,
  BookingReceipt,
  BookingRequest,
  EnquiryReceipt,
  EnquiryRequest,
  HandoverStatus,
  LobbyServiceAdapter,
  ReceptionReply,
  ReceptionTurn,
  ServiceOption,
  ServiceOutcome,
  ServiceUnavailable,
} from './types'

const APPOINTMENTS = 'Aicountly Appointments'
const RECEPTION_AI = 'Lobby reception AI'
const HANDOVER = 'Reception desk'

function unavailable(integration: string, reason: string): ServiceUnavailable {
  return { status: 'unavailable', integration, reason }
}

/**
 * Why a booking capability cannot run, in the server's own words.
 *
 * The sentence is not composed here. Whether booking is switched off for this
 * business, whether Appointments refused the slot, and whether it could not be
 * reached are three different things that need three different responses from
 * the visitor, and only the server knows which one happened.
 */
function appointmentsUnavailable(reason: string): ServiceUnavailable {
  return unavailable(APPOINTMENTS, reason)
}

/**
 * Is booking switched on for this business?
 *
 * Read from the capability report — a server fact about the tenant's published
 * configuration — rather than from a build-time flag. A business that has not
 * switched booking on has no booking journey, whatever this bundle was built
 * with.
 */
function bookingOffered(): boolean {
  return api().lastCapabilities()?.journeys?.booking ?? false
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
    if (!bookingOffered()) {
      return appointmentsUnavailable('This business does not take appointments through reception.')
    }

    const result = await api().bookableServices()
    if (!result.ok) return appointmentsUnavailable(result.reason)

    return {
      status: 'ok',
      mode: 'live',
      data: result.data.map((service) => ({
        id: service.id,
        label: service.label,
        description: service.description,
        durationMinutes: service.durationMinutes,
      })),
    }
  },

  async listAvailability(serviceId: string, date: string): Promise<ServiceOutcome<AvailabilitySlot[]>> {
    // Availability is Calendar's data, surfaced through Appointments. Lobby
    // must not query Calendar directly and must not cache what it returns.
    if (!bookingOffered()) {
      return appointmentsUnavailable('This business does not take appointments through reception.')
    }

    const result = await api().bookableSlots(serviceId, date)
    if (!result.ok) {
      // Deliberately not an empty slot list. Appointments distinguishes "no
      // times free" from "the calendar could not be read", and collapsing the
      // second into the first would have a visitor give up on a day that is
      // actually wide open.
      return appointmentsUnavailable(result.reason)
    }

    return {
      status: 'ok',
      mode: 'live',
      data: result.data.map((slot) => ({
        id: slot.id,
        time: slot.startsAt,
        label: slot.label || new Date(slot.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      })),
    }
  },

  async requestBooking(request: BookingRequest): Promise<ServiceOutcome<BookingReceipt>> {
    if (!bookingOffered()) {
      return appointmentsUnavailable('This business does not take appointments through reception.')
    }

    const result = await api().book({
      serviceId: request.serviceId,
      // The slot id IS the start time: Appointments takes a start time, and a
      // local slot id would need a table here to translate it back.
      startsAt: request.slotId,
      name: request.name,
      email: request.email,
      notes: request.notes,
    })

    if (!result.ok) {
      // Every refusal, unreachable service and uncertain outcome lands here
      // with the server's own sentence. Nothing in this branch may produce a
      // receipt: a reference this code invented is worse than no booking.
      return appointmentsUnavailable(result.reason)
    }

    return {
      status: 'ok',
      mode: 'live',
      data: {
        reference: result.data.reference,
        serviceLabel: result.data.serviceLabel,
        date: result.data.startsAt.slice(0, 10),
        time: new Date(result.data.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        demo: false,
        note: 'Aicountly Appointments confirmed this booking and holds the record.',
      },
    }
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

  /**
   * Ask for a person, and report exactly what the server recorded.
   *
   * Three different answers, and the visitor needs all three kept apart: you
   * are in the queue and this many are ahead; somebody is with you; or nobody
   * is at the desk, so your request is noted and you should leave an enquiry.
   * There is no branch that queues somebody quietly so the panel has something
   * reassuring to show.
   */
  async requestHandover(name: string, reason: string): Promise<ServiceOutcome<HandoverStatus>> {
    const result = await api().requestHandover(name, reason)
    if (!result.ok) return unavailable(HANDOVER, result.reason)

    return { status: 'ok', mode: 'live', data: { ...result.data, demo: false } }
  },

  async handoverStatus(): Promise<ServiceOutcome<HandoverStatus>> {
    const result = await api().handover()
    if (!result.ok) return unavailable(HANDOVER, result.reason)

    return { status: 'ok', mode: 'live', data: { ...result.data, demo: false } }
  },

  async cancelHandover(): Promise<ServiceOutcome<HandoverStatus>> {
    const result = await api().cancelHandover()
    if (!result.ok) return unavailable(HANDOVER, result.reason)

    return { status: 'ok', mode: 'live', data: { ...result.data, demo: false } }
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
      // A server fact about this tenant, not a build flag. Whether a call
      // succeeds is only knowable by making one, which the journey does.
      connected: report?.journeys?.booking ?? false,
      detail:
        report?.journeys?.booking === true
          ? 'Booking is switched on for this business. Requests are relayed by this product’s API, which holds the Appointments service key; the browser never sees it.'
          : 'Not offered by this business. Switch it on under Business setup → Visitor services.',
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
          ? 'Answering through this product’s own API. The model credential is held by Aicountly Console and never reaches the browser.'
          // The fallback is only used when the capability report could not be
          // fetched at all. It names no variable: this string ships in the
          // browser bundle, where a list of a server’s configuration gaps is
          // free reconnaissance, and the server’s own reason is the accurate
          // one when there is one.
          : (report?.conversation.reason ??
            'Not connected. The model credential is governed by Aicountly Console and is server-side only.'),
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
