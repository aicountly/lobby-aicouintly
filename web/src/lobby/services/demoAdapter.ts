/**
 * The demonstration adapter.
 *
 * Everything here happens in this file, in this tab. It opens no socket, writes
 * to no store and reaches no other Aicountly application, so running through a
 * journey twice has no consequence the second time. Every receipt it returns is
 * flagged `demo: true`, and the interface renders that flag as a badge rather
 * than trusting itself to remember.
 *
 * This file must never import from `liveAdapter.ts`, and `liveAdapter.ts` must
 * never import from this one. Keeping the two apart is the whole point: a demo
 * journey that could reach a production call is not a demo journey.
 */
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
} from './types'

const SERVICES: ServiceOption[] = [
  {
    id: 'discovery',
    label: 'Discovery call',
    description: 'A first conversation about what you need and whether Aicountly fits.',
    durationMinutes: 30,
  },
  {
    id: 'onboarding',
    label: 'Onboarding session',
    description: 'Walk through setting up your books, users and opening balances.',
    durationMinutes: 60,
  },
  {
    id: 'support',
    label: 'Support clinic',
    description: 'Bring a specific problem in an existing account.',
    durationMinutes: 20,
  },
  {
    id: 'finance-review',
    label: 'Finance review',
    description: 'A walk through your reporting with a finance specialist.',
    durationMinutes: 45,
  },
]

/** Answers built from the question, with no model behind them. */
const SCRIPTED_ANSWERS: { match: RegExp; text: string; suggestions: string[] }[] = [
  {
    match: /\b(open|hours|time|close|closing|when)\b/i,
    text: 'The demonstration lobby is staffed 09:00–17:30, Monday to Friday. Real opening hours will come from the tenant record once Lobby is connected to it.',
    suggestions: ['Where are you based?', 'I would like to book an appointment'],
  },
  {
    match: /\b(where|address|located|location|parking|directions)\b/i,
    text: 'This is a demonstration lobby, so there is no address behind it yet. A connected deployment would read the office address from the tenant profile.',
    suggestions: ['What are your opening hours?', 'What can Aicountly do?'],
  },
  {
    match: /\b(book|appointment|meeting|schedule|slot)\b/i,
    text: 'Booking is on the first card in this panel — "Book an appointment". In this demonstration it walks the whole journey and stops before anything is written.',
    suggestions: ['Who owns my calendar data?', 'I have a different question'],
  },
  {
    match: /\b(price|pricing|cost|quote|plan|subscription)\b/i,
    text: 'Pricing is not something this demonstration can answer — it is commercial data this lobby does not hold. Leave an enquiry and a person would pick it up.',
    suggestions: ['Make an enquiry', 'What can Aicountly do?'],
  },
  {
    match: /\b(calendar|data|store|stored|privacy|gdpr|own)\b/i,
    text: 'Calendar records belong to Aicountly Calendar and appointments to Aicountly Appointments. Lobby keeps no copy of either — it asks those applications over their APIs and shows you the answer.',
    suggestions: ['I would like to book an appointment', 'What are your opening hours?'],
  },
  {
    match: /\b(what|who|about|aicountly|do you|product|service)\b/i,
    text: 'Aicountly is a family of business applications — books, billing, sales, purchases, point of sale, appointments and more — that share one sign-in. Lobby is the front door.',
    suggestions: ['I would like to book an appointment', 'What are your opening hours?'],
  },
]

const FALLBACK: ReceptionReply = {
  text: 'This demonstration only recognises a handful of questions, and that was not one of them. Try asking about opening hours, booking, or what Aicountly does — or leave an enquiry and a person would answer it.',
  demo: true,
  suggestions: ['What are your opening hours?', 'What can Aicountly do?', 'Make an enquiry'],
}

/** Stable pseudo-randomness, so the same date always offers the same slots. */
function hash(input: string): number {
  let value = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    value ^= input.charCodeAt(i)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

function reference(prefix: string): string {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5)
  const salt = Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()
    .padStart(2, '0')
  return `${prefix}-DEMO-${stamp}${salt}`
}

/** A short pause, so the interface's loading states are actually exercised. */
function settle<T>(value: T, ms = 260): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(value), ms)
  })
}

function ok<T>(data: T): ServiceOutcome<T> {
  return { status: 'ok', mode: 'demo', data }
}

export const demoAdapter: LobbyServiceAdapter = {
  mode: 'demo',
  description:
    'Demonstration journeys that run entirely in this browser tab. Nothing is booked, sent or stored.',

  async listServices() {
    return settle(ok(SERVICES))
  },

  async listAvailability(serviceId, date) {
    const seed = hash(`${serviceId}:${date}`)
    const times = ['09:00', '09:45', '10:30', '11:15', '13:00', '14:00', '15:30', '16:15']
    const slots: AvailabilitySlot[] = times
      // Drop a couple of times per day so the grid looks like a real diary.
      .filter((_, index) => ((seed >> index) & 1) === 0 || index % 3 === 0)
      .map((time) => ({
        id: `${date}T${time}`,
        time,
        label: `${time} · demo availability`,
      }))

    return settle(ok(slots))
  },

  async requestBooking(request: BookingRequest) {
    const service = SERVICES.find((s) => s.id === request.serviceId)
    const receipt: BookingReceipt = {
      reference: reference('APT'),
      serviceLabel: service?.label ?? 'Appointment',
      date: request.date,
      time: request.slotId.split('T')[1] ?? request.slotId,
      demo: true,
      note: 'Demonstration only. No appointment was created and Aicountly Calendar was not contacted.',
    }
    return settle(ok(receipt))
  },

  async submitEnquiry(request: EnquiryRequest) {
    const receipt: EnquiryReceipt = {
      reference: reference('ENQ'),
      demo: true,
      note: `Demonstration only. Nothing was sent, and no record of this ${request.topic} enquiry was kept.`,
    }
    return settle(ok(receipt))
  },

  async askReception(question: string, _history: ReceptionTurn[]) {
    const matched = SCRIPTED_ANSWERS.find((answer) => answer.match.test(question))
    const reply: ReceptionReply = matched
      ? { text: matched.text, demo: true, suggestions: matched.suggestions }
      : FALLBACK
    return settle(ok(reply), 420)
  },
}
